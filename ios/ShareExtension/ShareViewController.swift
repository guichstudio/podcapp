import SwiftUI
import UIKit
import UniformTypeIdentifiers


/// Temporary instrument, not a feature. Remove with its call sites once the
/// cause is known.
///
/// The extension fails on Louis's iPhone in a way nothing observable from this
/// machine can separate: an empty sheet that closes could be our SwiftUI
/// rendering nothing, or iOS showing its own placeholder because the appex
/// never launched. There is no crash report either way, and macOS cannot stream
/// a paired device's log. So the extension leaves a breadcrumb trail in the App
/// Group container, which `devicectl device copy from` reads back -- and the
/// absence of the file is itself the answer to "did the process ever start".
enum ShareLog {
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    private static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Config.appGroup)?
            .appendingPathComponent("share-debug.log")
    }

    /// First thing in viewDidLoad, so each attempt starts a fresh trail and an
    /// old one is never mistaken for the current run.
    static func begin() {
        guard let url = fileURL else { return }
        try? Data("--- run start\n".utf8).write(to: url)
    }

    static func note(_ line: String) {
        guard let url = fileURL else { return }
        let data = Data("\(clock.string(from: Date())) \(line)\n".utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: url)
        }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    // The haptic hangs on the state itself rather than on each of the six places
    // that set it, which is also why the extension cannot forget one. No sound:
    // this sheet sits on top of somebody else's app.
    @Published var state: State = .saving {
        didSet {
            ShareLog.note("state -> \(state)")
            switch state {
            case .saved: Feedback.saved(sound: false)
            case .failed: Feedback.refused(sound: false)
            case .saving: break
            }
        }
    }
    enum State: Equatable { case saving, saved(String), failed(String) }
}

// The whole point of the app: receive a link from any other app and record it.
// It shows what happened and closes itself, so saving never costs more than a tap.
class ShareViewController: UIViewController {
    // Owned here and passed in, not declared @StateObject inside the view:
    // SwiftUI owns a @StateObject and this controller could not reach the same
    // instance to report the result into.
    private let model = ShareModel()

    private let banner: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.numberOfLines = 0
        l.textAlignment = .center
        l.font = .systemFont(ofSize: 15, weight: .semibold)
        l.textColor = .label
        l.text = "Podcapp"
        return l
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        ShareLog.begin()
        ShareLog.note("viewDidLoad, group=\(Config.sharesStorageWithExtension) token=\(Config.isConfigured) base=\(Config.baseURL)")
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
        ShareLog.note("hosting mounted, view=\(view.bounds.size.width)x\(view.bounds.size.height)")

        // Drawn by UIKit, above the SwiftUI host, on purpose: if this line shows
        // and the rest of the sheet stays empty, SwiftUI is what is not
        // rendering; if the sheet is empty even of this, the extension is not
        // getting to draw at all. Temporary, like ShareLog.
        view.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            banner.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            banner.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
        ])

        Task { await handleInput() }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func handleInput() async {
        ShareLog.note("handleInput items=\(extensionContext?.inputItems.count ?? -1)")
        guard let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
              let providers = item.attachments, !providers.isEmpty else {
            model.state = .failed(String(localized: "Nothing to save."))
            return
        }
        ShareLog.note("attachments=\(providers.map { $0.registeredTypeIdentifiers.joined(separator: "+") }.joined(separator: " | "))")
        do {
            if let url = try await firstURL(in: providers) {
                ShareLog.note("posting url \(url.absoluteString)")
                try await Ingest.save(url: url, text: nil)
                ShareLog.note("saved ok")
                banner.text = "Podcapp — saved \(url.host ?? "")"
                model.state = .saved(url.host ?? url.absoluteString)
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
                try await Ingest.save(url: url, text: nil)
                model.state = .saved(url.host ?? url.absoluteString)
            } else {
                try await Ingest.save(url: nil, text: trimmed)
                model.state = .saved(String(localized: "Note saved"))
            }
        } catch {
            ShareLog.note("threw: \(error.localizedDescription)")
            banner.text = "Podcapp — failed\n\(error.localizedDescription)"
            model.state = .failed(error.localizedDescription)
        }
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

struct ShareView: View {
    @ObservedObject var model: ShareModel
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            // A title, so a sheet that renders but has nothing else to show is
            // still obviously Podcapp's rather than "an empty window".
            Text("Podcapp")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)

            switch model.state {
            case .saving:
                ProgressView()
                Text("Saving").foregroundStyle(.secondary)
            case let .saved(detail):
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
                Text("Saved").font(.headline)
                Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            case let .failed(message):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 44)).foregroundStyle(.orange)
                Text("Failed").font(.headline)
                Text(message).font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal)
            }
            Button("Close", action: onDone).padding(.top, 4)
        }
        .padding(28)
        // Fill the host rather than hugging its content: the sheet is sized by
        // the view controller, and a self-sized VStack in a zero-height host
        // draws nothing at all.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .onChange(of: model.state) { _, new in
            // A success needs no acknowledgement and closes itself. A failure stays
            // on screen, because the reason is the only useful part of it.
            if case .saved = new {
                Task { try? await Task.sleep(for: .seconds(1)); onDone() }
            }
        }
    }
}
