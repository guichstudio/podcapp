import SwiftUI

struct ContentView: View {
    @State private var token = Config.apiToken
    @State private var baseURL = Config.baseURL
    @State private var status: Status = .idle

    enum Status: Equatable {
        case idle, checking, ok(String), failed(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Jeton d'API", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Serveur", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Connexion")
                } footer: {
                    Text("Le jeton est stocké sur l'appareil et partagé avec l'extension. Il n'est jamais envoyé ailleurs qu'à votre serveur.")
                }

                Section {
                    Button("Enregistrer et tester") { Task { await check() } }
                        .disabled(token.isEmpty || status == .checking)
                    switch status {
                    case .checking:
                        HStack { ProgressView(); Text("Test en cours").foregroundStyle(.secondary) }
                    case let .ok(message):
                        Label(message, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case let .failed(message):
                        Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    case .idle:
                        EmptyView()
                    }
                }

                Section {
                    Text("Partagez un lien depuis Safari ou n'importe quelle app, puis choisissez Briefing. Le lien rejoint votre prochain épisode.")
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Utilisation")
                }
            }
            .navigationTitle("Briefing")
        }
    }

    // The test writes a real source: a round trip against production is the only
    // way to know the token works, and a stray note is cheap to ignore.
    private func check() async {
        Config.apiToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        Config.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        status = .checking
        do {
            try await Ingest.save(url: nil, text: "Test de connexion depuis l'app Briefing.")
            status = .ok("Connecté. Le partage est prêt.")
        } catch {
            status = .failed(error.localizedDescription)
        }
    }
}
