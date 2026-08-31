import SwiftUI

// The Settings tab of ios/design/layout.html (<sc-if value="{{ tabSettings }}">),
// plus everything ContentView owns today: the app token, the server address and
// the "Enregistrer et tester" round trip. This screen replaces ContentView, so
// that behaviour has to keep working here, in the design's language rather than
// in a Form.
//
// The generation settings below are read-only on purpose: voice, target length
// and the RSS token live on the machine that generates episodes, and the API
// exposes none of them. Inventing values here would be worse than saying so.
struct SettingsView: View {
    @State private var token = Config.apiToken
    @State private var server = Config.baseURL
    @State private var connection: Connection = .idle
    // Config is plain UserDefaults and publishes nothing, so the saved state is
    // mirrored here and refreshed by saveAndTest() instead of read mid-render.
    @State private var isConfigured = Config.isConfigured

    enum Connection: Equatable {
        case idle
        case checking
        case ok(String)
        case failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Réglages")
                    .typo(Typo.screenTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 6)
                    .padding(.bottom, 16)

                connectionSection
                    .padding(.bottom, 22)

                languageCard
                    .padding(.bottom, 12)

                Text("Ces réglages s’affichent seulement, ils se changent sur l’ordinateur qui génère les épisodes.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)

                generationCard

                Text("Le flux RSS reste compatible, Apple Podcasts, Overcast.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 14)
                    .padding(.horizontal, 4)

                Text("Son adresse contient un jeton que le serveur ne renvoie pas à l’app : copiez-la depuis l’ordinateur qui publie les épisodes.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 6)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Connexion

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Jeton d’API")
                // No textContentType: an API token is not a website password, and
                // declaring one makes iOS offer to save it as a login.
                SecureField("Collez votre jeton", text: $token)
                    .inputField()
            }

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Serveur")
                TextField(Config.defaultBaseURL, text: $server)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .inputField()
            }

            testButton
            connectionStatus

            Text("Le jeton est stocké sur l’appareil et partagé avec l’extension. Il n’est envoyé qu’à votre serveur.")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .padding(.horizontal, 4)
        }
    }

    private var testButton: some View {
        Button {
            Task { await saveAndTest() }
        } label: {
            Text("Enregistrer et tester")
                .typo(Typo.buttonLarge)
                .foregroundStyle(Palette.onDark)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .padding(.horizontal, 22)
                .background(Palette.ink, in: Capsule())
                // A lifted shadow under a button that cannot be pressed reads as
                // enabled, so it goes with the fade the design uses for inert rows.
                .shadow(color: Palette.ink.opacity(canTest ? 0.22 : 0), radius: 12, y: 8)
        }
        .buttonStyle(.plain)
        .disabled(!canTest)
        .opacity(canTest ? 1 : 0.55)
    }

    private var canTest: Bool {
        !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && connection != .checking
    }

    @ViewBuilder
    private var connectionStatus: some View {
        switch connection {
        case .idle:
            if isConfigured {
                statusLine(
                    "Jeton enregistré sur cet appareil. Testez pour vérifier qu’il est toujours accepté.",
                    icon: "checkmark.seal",
                    color: Palette.muted2
                )
            } else {
                statusLine(
                    "Aucun jeton. Ajoutez-le pour charger vos briefings et partager des liens.",
                    icon: "info.circle",
                    color: Palette.muted2
                )
            }
        case .checking:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Test en cours")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                Spacer(minLength: 0)
            }
        case let .ok(message):
            statusLine(message, icon: "checkmark.circle.fill", color: Palette.success)
        case let .failed(message):
            statusLine(message, icon: "exclamationmark.triangle.fill", color: Palette.danger)
        }
    }

    private func statusLine(_ text: String, icon: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
            Text(text)
                .typo(Typo.metaSmall)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 4)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .typo(Typo.metaSmall)
            .foregroundStyle(Palette.muted2)
            .padding(.horizontal, 4)
    }

    // The test writes a real source: a round trip against production is the only
    // way to know the token works, and a stray note is cheap to ignore.
    private func saveAndTest() async {
        let cleanToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanServer = server.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        // An emptied field would be stored as "" and every later call would fail
        // on an invalid URL, with no way back except reinstalling the app.
        let resolvedServer = cleanServer.isEmpty ? Config.defaultBaseURL : cleanServer

        token = cleanToken
        server = resolvedServer
        Config.apiToken = cleanToken
        Config.baseURL = resolvedServer
        isConfigured = Config.isConfigured
        connection = .checking

        do {
            try await Ingest.save(url: nil, text: "Test de connexion depuis l’app Briefing.")
            connection = .ok("Connecté. Le partage est prêt.")
        } catch {
            connection = .failed(error.localizedDescription)
        }
    }

    // MARK: - Langue

    private var languageCard: some View {
        PlainCard(cornerRadius: 16, padding: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Langue de l’app")
                        .typo(Typo.listTitle)
                        .foregroundStyle(Palette.ink)
                    Text("Interface et narration en français. L’anglais n’est pas encore traduit.")
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                }
                Spacer(minLength: 0)
                languagePicker
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
        }
    }

    // Both options are shown as the design draws them, but the app ships one set
    // of strings: EN stays inert rather than switching to a half-translated UI.
    private var languagePicker: some View {
        HStack(spacing: 0) {
            languageOption("FR", selected: true)
            languageOption("EN", selected: false)
        }
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Palette.ink.opacity(0.14), lineWidth: 1))
        .fixedSize()
    }

    private func languageOption(_ label: String, selected: Bool) -> some View {
        Text(label)
            .typo(Typo.buttonSmall)
            .foregroundStyle(selected ? Palette.onDark : Palette.body)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(selected ? Palette.ink : Color.clear)
            .opacity(selected ? 1 : 0.4)
    }

    // MARK: - Fabrication

    private struct GenerationRow: Identifiable {
        let label: String
        let sub: String
        let value: String

        var id: String { label }
    }

    private var generationRows: [GenerationRow] {
        [
            GenerationRow(label: "Langue de sortie", sub: "Scripts et narration", value: "Français"),
            GenerationRow(label: "Durée cible", sub: "Budget d’antenne fixé avant l’écriture", value: "15 min"),
            GenerationRow(label: "Génération", sub: "Lancée depuis l’ordinateur", value: "Manuelle"),
            // States the fact, not a promise: a token can be stored and still be
            // refused, and only the test above knows whether the server takes it.
            GenerationRow(
                label: "Extension de partage",
                sub: "Partagez un lien depuis Safari, puis choisissez Briefing",
                value: isConfigured ? "Jeton enregistré" : "Jeton requis"
            ),
            GenerationRow(label: "Flux RSS privé", sub: "Apple Podcasts, Overcast", value: "Non affiché"),
        ]
    }

    private var generationCard: some View {
        let rows = generationRows
        return PlainCard(cornerRadius: 16, padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    generationRowView(row)
                    if index < rows.count - 1 {
                        Rectangle()
                            .fill(Palette.hairline)
                            .frame(height: 1)
                    }
                }
            }
        }
    }

    private func generationRowView(_ row: GenerationRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.label)
                    .typo(Typo.listTitle)
                    .foregroundStyle(Palette.ink)
                Text(row.sub)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
            Spacer(minLength: 0)
            Text(row.value)
                .typo(Typo.buttonMedium)
                .foregroundStyle(Palette.body)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
    }
}

private extension View {
    /// The input chrome of the design's capture bar: white .8 on a hairline border.
    func inputField() -> some View {
        self
            .typo(Typo.rowTitle)
            .foregroundStyle(Palette.ink)
            .tint(Palette.accentDeep)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Palette.cardBorder, lineWidth: 1)
            )
    }
}

// MARK: - Previews

#Preview("Réglages") {
    SettingsView()
}
