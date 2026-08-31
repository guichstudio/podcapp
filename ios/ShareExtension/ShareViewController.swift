import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class ShareModel: ObservableObject {
    @Published var state: State = .saving
    enum State: Equatable { case saving, saved(String), failed(String) }
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
        let controller = UIHostingController(
            rootView: ShareView(model: model, onDone: { [weak self] in self?.finish() })
        )
        addChild(controller)
        controller.view.frame = view.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(controller.view)
        controller.didMove(toParent: self)

        Task { await handleInput() }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func handleInput() async {
        guard let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
              let providers = item.attachments, !providers.isEmpty else {
            model.state = .failed("Rien à sauvegarder.")
            return
        }
        do {
            if let url = try await firstURL(in: providers) {
                try await Ingest.save(url: url, text: nil)
                model.state = .saved(url.host ?? url.absoluteString)
                return
            }
            guard let text = try await firstText(in: providers) else {
                model.state = .failed("Type de contenu non pris en charge.")
                return
            }
            // Several apps hand a link over as plain text rather than as a URL
            // attachment, and it is worth far more to the pipeline as a link.
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: trimmed), url.scheme?.hasPrefix("http") == true {
                try await Ingest.save(url: url, text: nil)
                model.state = .saved(url.host ?? trimmed)
            } else {
                try await Ingest.save(url: nil, text: trimmed)
                model.state = .saved("Note enregistrée")
            }
        } catch {
            model.state = .failed(error.localizedDescription)
        }
    }

    private func firstURL(in providers: [NSItemProvider]) async throws -> URL? {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                return url
            }
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
            switch model.state {
            case .saving:
                ProgressView()
                Text("Enregistrement").foregroundStyle(.secondary)
            case let .saved(detail):
                Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
                Text("Sauvegardé").font(.headline)
                Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            case let .failed(message):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 44)).foregroundStyle(.orange)
                Text("Échec").font(.headline)
                Text(message).font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal)
            }
            Button("Fermer", action: onDone).padding(.top, 4)
        }
        .padding(28)
        .onChange(of: model.state) { _, new in
            // A success needs no acknowledgement and closes itself. A failure stays
            // on screen, because the reason is the only useful part of it.
            if case .saved = new {
                Task { try? await Task.sleep(for: .seconds(1)); onDone() }
            }
        }
    }
}
