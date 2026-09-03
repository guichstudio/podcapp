import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class ShareModel: ObservableObject {
    // The haptic hangs on the state itself rather than on each of the six places
    // that set it, which is also why the extension cannot forget one. No sound:
    // this sheet sits on top of somebody else's app.
    @Published var state: State = .saving {
        didSet {
            switch state {
            case .saved: Feedback.saved(sound: false)
            case .failed: Feedback.refused(sound: false)
            case .saving: break
            }
        }
    }
    enum State: Equatable { case saving, saved(Saved), failed(String) }

    /// What the confirmation actually shows, from the design's own list: the
    /// title, where it came from, and how close the next episode now is.
    ///
    /// The category chip the design puts beside the count is NOT here, and that
    /// is deliberate. A source is filed on a shelf by the analyser, minutes
    /// after this sheet has closed; there is nothing to show at save time and
    /// inventing one would be the fake UI this project refuses elsewhere.
    struct Saved: Equatable {
        let title: String
        let host: String
        let kind: Kind
        let at: Date
        let available: Int?
        let minimum: Int?

        enum Kind: Equatable {
            case article, video, note

            var label: String {
                switch self {
                case .article: return String(localized: "article")
                case .video: return String(localized: "video")
                case .note: return String(localized: "note")
                }
            }
        }
    }
}

// The whole point of the app: receive a link from any other app and record it.
// It shows what happened and closes itself, so saving never costs more than a tap.
class ShareViewController: UIViewController {
    // Owned here and passed in, not declared @StateObject inside the view:
    // SwiftUI owns a @StateObject and this controller could not reach the same
    // instance to report the result into.
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        // The sheet has to paint something even if SwiftUI never lays out: a
        // share extension with a clear background over a zero-sized host reads
        // as "an empty window opened and closed", which is exactly how this
        // failed on device. An opaque background plus real constraints means
        // the worst case is a blank *card*, not a blank screen.
        view.backgroundColor = .systemBackground

        let controller = UIHostingController(
            rootView: ShareView(model: model, onDone: { [weak self] in self?.finish() })
        )
        // The hosting view must not inherit SwiftUI's clear default either.
        controller.view.backgroundColor = .systemBackground
        addChild(controller)
        // Constraints rather than frame + autoresizingMask: viewDidLoad runs
        // before the extension's view has been sized, so the frame copied here
        // can be .zero, and autoresizing only grows it if the parent is later
        // resized -- which does not happen when the host presents the view
        // already at its final size.
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        controller.didMove(toParent: self)

        Task { await handleInput() }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func handleInput() async {
        guard let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
              let providers = item.attachments, !providers.isEmpty else {
            model.state = .failed(String(localized: "Nothing to save."))
            return
        }
        // Most apps hand the page title over as the item's own content text --
        // Safari always does -- which is the only place a title can come from
        // at save time: extraction runs in the cloud, minutes later.
        let offered = (item.attributedContentText?.string).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        do {
            if let url = try await firstURL(in: providers) {
                let receipt = try await Ingest.save(url: url, text: nil)
                model.state = .saved(saved(url: url, title: offered, receipt: receipt))
                return
            }
            guard let text = try await firstText(in: providers) else {
                model.state = .failed(String(localized: "Unsupported content type."))
                return
            }
            // Several apps hand a link over as plain text rather than as a URL
            // attachment, and it is worth far more to the pipeline as a link.
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = firstWebURL(in: trimmed) {
                let receipt = try await Ingest.save(url: url, text: nil)
                // The sentence the link was wrapped in is a better title than
                // the host, but only when it is not simply the link again.
                let wrapper = trimmed == url.absoluteString ? offered : trimmed
                model.state = .saved(saved(url: url, title: wrapper, receipt: receipt))
            } else {
                let receipt = try await Ingest.save(url: nil, text: trimmed)
                model.state = .saved(ShareModel.Saved(
                    title: trimmed,
                    host: String(localized: "Saved text"),
                    kind: .note,
                    at: Date(),
                    available: receipt.available,
                    minimum: receipt.minimum
                ))
            }
        } catch {
            model.state = .failed(error.localizedDescription)
        }
    }

    /// A title only when the sharing app gave a real one: Instagram and X hand
    /// over a caption that is worth keeping, while a title equal to the link
    /// itself is noise. Falls back to the host, which is always true.
    private func saved(url: URL, title: String?, receipt: Ingest.Receipt) -> ShareModel.Saved {
        let host = (url.host ?? url.absoluteString).replacingOccurrences(of: "www.", with: "", options: .anchored)
        let cleaned = title.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
        let usable = cleaned.isEmpty || cleaned == url.absoluteString || cleaned.hasPrefix("http") ? nil : cleaned
        return ShareModel.Saved(
            title: usable ?? host,
            host: host,
            kind: ShareViewController.kind(of: url),
            at: Date(),
            available: receipt.available,
            minimum: receipt.minimum
        )
    }

    /// Said from the address alone, because nothing else is known yet. Only the
    /// video hosts are claimed; everything else is called an article rather
    /// than guessed at.
    private static func kind(of url: URL) -> ShareModel.Saved.Kind {
        let host = (url.host ?? "").lowercased()
        let video = ["youtube.com", "youtu.be", "m.youtube.com", "vimeo.com", "dailymotion.com", "tiktok.com"]
        return video.contains(where: { host == $0 || host.hasSuffix("." + $0) }) ? .video : .article
    }

    /// The first http(s) URL among the attachments. Deliberately not "the first
    /// public.url attachment": several apps put a deep link (youtube://...) or a
    /// file URL in front of the web address, and the pipeline can only fetch a
    /// page over http. A non-web URL is skipped rather than saved, so the text
    /// path below still gets its turn.
    private func firstURL(in providers: [NSItemProvider]) async throws -> URL? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            guard let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
                  isWeb(url) else { continue }
            return url
        }
        return nil
    }

    private func isWeb(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    /// The first web link *inside* a piece of text. Instagram, X and YouTube
    /// hand over a sentence with the link embedded -- "Check this out!
    /// https://youtu.be/abc", "https://x.com/u/status/1 via @x" -- and
    /// URL(string:) on the whole sentence returns nil, so the promo text was
    /// saved instead of the article. NSDataDetector is what iOS itself uses to
    /// find links in prose, trailing punctuation and following words included.
    ///
    /// The link wins over the prose whenever there is one, even mid-sentence.
    /// That is a deliberate trade: this is a link-capture extension, the words
    /// wrapped around a shared post are the sharing app's, not the reader's,
    /// and a fetched article is worth more to the briefing than a caption. Text
    /// the reader means to keep verbatim goes through the app's own paste
    /// field, which still only treats a string STARTING with http(s) as a link.
    private func firstWebURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in detector.matches(in: text, options: [], range: range) {
            if let url = match.url, isWeb(url) { return url }
        }
        return nil
    }

    private func firstText(in providers: [NSItemProvider]) async throws -> String? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                return text
            }
        }
        return nil
    }
}

extension NSItemProvider {
    // Pinned to the main actor: NSItemProvider is not Sendable, and the callers
    // are all main-actor bound, so nothing hands it across a boundary. Resuming
    // the continuation from the provider's own queue is safe.
    @MainActor
    func loadItem(forTypeIdentifier identifier: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: identifier, options: nil) { item, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: item) }
            }
        }
    }
}

/// The confirmation sheet of "Podcapp Saved + Notifications" (FR 01 / EN 01),
/// ported against the artboard's own computed values rather than by eye: the
/// 393x852 frame, the scrim, the 46pt mark, the 96pt disc inside its 128pt
/// glow, and the type ramp 30/700 -0.6, 17/700 at 1.35, 13.5/500.
///
/// One thing from the artboard is missing on purpose: the category chip beside
/// the count. Shelves are assigned by the analyser minutes after this sheet has
/// closed, so there is nothing true to put there -- see ShareModel.Saved.
struct ShareView: View {
    @ObservedObject var model: ShareModel
    let onDone: () -> Void

    // The artboard's palette, local to the extension: it compiles only three
    // files and none of them is the app's Palette.
    private enum Ink {
        static let base = Color(red: 0x0E / 255, green: 0x0D / 255, blue: 0x12 / 255)
        static let text = Color(red: 0xF5 / 255, green: 0xF5 / 255, blue: 0xF3 / 255)
        static let muted = Color(red: 0x8E / 255, green: 0x8A / 255, blue: 0xA0 / 255)
        static let count = Color(red: 0xC4 / 255, green: 0xB9 / 255, blue: 0xFF / 255)
        static let unit = Color(red: 0xB3 / 255, green: 0xAF / 255, blue: 0xC4 / 255)
        static let green = Color(red: 0x3F / 255, green: 0xBF / 255, blue: 0x6B / 255)
        static let glow = Color(red: 0x50 / 255, green: 0xD6 / 255, blue: 0x7C / 255)
        static let warn = Color(red: 0xE8 / 255, green: 0x8B / 255, blue: 0x3D / 255)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            mark
            Text("Podcapp")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Ink.muted)
                .padding(.top, 16)

            disc.padding(.top, 42)

            headline
                .font(.system(size: 30, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(Ink.text)
                .padding(.top, 28)

            detail.padding(.top, 18)

            Spacer(minLength: 0)

            // The way out is always reachable, including while the request is
            // still in flight: a share that hangs must never trap the reader in
            // somebody else's app.
            Button(action: onDone) {
                Text("Close")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Ink.muted)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .multilineTextAlignment(.center)
        .background {
            // The artboard darkens the host page from .6 to .9. Opaque here on
            // purpose: an extension sheet that can render as nothing is exactly
            // what cost this project an afternoon, and at those alphas over a
            // dark page the difference is not worth the risk.
            LinearGradient(
                colors: [Ink.base.opacity(0.94), Ink.base],
                startPoint: .top,
                endPoint: .bottom
            )
            .overlay(Ink.base.opacity(0.6))
        }
        .onChange(of: model.state) { _, new in
            // A success needs no acknowledgement and closes itself. A failure
            // stays, because the reason is the only useful part of it. 1.6s
            // rather than 1: the sheet now has a title and a count to read.
            if case .saved = new {
                Task { try? await Task.sleep(for: .seconds(1.6)); onDone() }
            }
        }
    }

    // MARK: - Pieces

    @ViewBuilder
    private var mark: some View {
        if let logo = ShareView.logo {
            Image(uiImage: logo)
                .resizable()
                .frame(width: 46, height: 46)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            // No mark rather than a stand-in: the wordmark below already says
            // whose sheet this is.
            Color.clear.frame(width: 46, height: 46)
        }
    }

    /// Read out of the containing app's bundle. An appex lives at
    /// Podcapp.app/PlugIns/ShareExtension.appex, so two levels up is the app,
    /// and the image ships there already -- which beats duplicating it into the
    /// extension, and beats a new resources build phase in a project file that
    /// cannot currently be regenerated on this machine.
    private static let logo: UIImage? = {
        let app = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        return UIImage(contentsOfFile: app.appendingPathComponent("logo.png").path)
    }()

    /// The 96pt disc sitting inside a 128pt radial glow, per the artboard.
    private var disc: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [glowColour.opacity(0.3), .clear], center: .center, startRadius: 0, endRadius: 45))
                .frame(width: 128, height: 128)
            Circle()
                .fill(discColour)
                .frame(width: 96, height: 96)
                .overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                .shadow(color: discColour.opacity(0.4), radius: 22, y: 18)
            glyph
        }
        .frame(width: 128, height: 128)
    }

    @ViewBuilder
    private var glyph: some View {
        switch model.state {
        case .saving:
            ProgressView().tint(.white).scaleEffect(1.4)
        case .saved:
            Image(systemName: "checkmark")
                .font(.system(size: 42, weight: .bold))
                .foregroundStyle(.white)
        case .failed:
            Image(systemName: "exclamationmark")
                .font(.system(size: 42, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var discColour: Color {
        if case .failed = model.state { return Ink.warn }
        if case .saving = model.state { return Color.white.opacity(0.14) }
        return Ink.green
    }

    private var glowColour: Color {
        if case .failed = model.state { return Ink.warn }
        return Ink.glow
    }

    private var headline: Text {
        switch model.state {
        case .saving: return Text("Saving")
        case .saved: return Text("Saved")
        case .failed: return Text("Failed")
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch model.state {
        case .saving:
            EmptyView()
        case let .failed(message):
            Text(message)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(Ink.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 40)
        case let .saved(saved):
            VStack(spacing: 0) {
                Text(saved.title)
                    .font(.system(size: 17, weight: .bold))
                    .lineSpacing(22.95 - 17)
                    .foregroundStyle(Ink.text)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 290)

                Text(ShareView.meta(saved))
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(Ink.muted)
                    .lineLimit(1)
                    .padding(.top, 12)

                if let available = saved.available, let minimum = saved.minimum {
                    countPill(available: available, minimum: minimum).padding(.top, 22)
                }
            }
        }
    }

    /// "en.wikipedia.org · article · 15:49", the artboard's own line.
    private static func meta(_ saved: ShareModel.Saved) -> String {
        [saved.host, saved.kind.label, clock.string(from: saved.at)].joined(separator: " · ")
    }

    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.locale = AppLocale.current
        f.setLocalizedDateFormatFromTemplate("j:mm")
        return f
    }()

    private func countPill(available: Int, minimum: Int) -> some View {
        HStack(spacing: 10) {
            Text(verbatim: "\(available)/\(minimum)")
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(Ink.count)
            Text("links")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Ink.unit)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 16)
        .background {
            Capsule()
                .fill(.white.opacity(0.1))
                .overlay(Capsule().strokeBorder(.white.opacity(0.18), lineWidth: 1))
        }
    }
}
