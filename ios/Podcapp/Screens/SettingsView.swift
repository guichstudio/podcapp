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
    // Config publishes nothing, so the switches keep their own state and write
    // through on change, like the token field above.
    @State private var haptics = Config.hapticsEnabled
    @State private var sounds = Config.soundEnabled

    enum Connection: Equatable {
        case idle
        case checking
        case ok(String)
        case failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Settings")
                    .typo(Typo.screenTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 6)
                    .padding(.bottom, 16)

                connectionSection
                    .padding(.bottom, 22)

                languageCard
                    .padding(.bottom, 12)

                feedbackCard
                    .padding(.bottom, 12)

                Text("These are shown, not set: they live on the machine that generates the episodes.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)

                generationCard

                Text("The RSS feed works in Apple Podcasts, Overcast and the rest.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 14)
                    .padding(.horizontal, 4)

                Text("Its address carries a token the server never sends back to the app: copy it from the machine that publishes the episodes.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 6)
                    .padding(.horizontal, 4)

                privacyLink
                    .padding(.top, 20)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: haptics) { _, on in
            Config.hapticsEnabled = on
            // Fires only when switched on, and that firing is the demonstration.
            if on { Feedback.tap() }
        }
        .onChange(of: sounds) { _, on in
            Config.soundEnabled = on
            if on { Feedback.saved() }
        }
    }

    // App Review 5.1.1 wants the privacy policy reachable from inside the app,
    // not only from the App Store listing. It follows the server field, so a build
    // pointed elsewhere reads that server's policy rather than a hardcoded one.
    @ViewBuilder
    private var privacyLink: some View {
        let base = server.trimmingCharacters(in: .whitespacesAndNewlines)
        let origin = base.hasSuffix("/") ? String(base.dropLast()) : base
        if let url = URL(string: origin + "/privacy"), url.scheme?.hasPrefix("http") == true {
            // The underline goes on the Text, not on the Link: on the Link the
            // modifier compiles and does nothing, and a caption-coloured line of
            // text with no affordance does not read as tappable.
            Link(destination: url) {
                Text("Privacy policy")
                    .typo(Typo.metaSmall)
                    .underline()
            }
            .foregroundStyle(Palette.muted2)
        }
    }

    // MARK: - Connexion

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("API token")
                // No textContentType: an API token is not a website password, and
                // declaring one makes iOS offer to save it as a login.
                SecureField("Paste your token", text: $token)
                    .inputField()
            }

            VStack(alignment: .leading, spacing: 6) {
                fieldLabel("Server")
                TextField(Config.defaultBaseURL, text: $server)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .inputField()
            }

            testButton
            connectionStatus

            Text("The token stays on this device and is shared with the extension. It is only ever sent to your server.")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .padding(.horizontal, 4)
        }
    }

    private var testButton: some View {
        Button {
            Task { await saveAndTest() }
        } label: {
            Text("Save and test")
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
                    "Token saved on this device. Test it to check the server still accepts it.",
                    icon: "checkmark.seal",
                    color: Palette.muted2
                )
            } else {
                statusLine(
                    "No token yet. Add one to load your briefings and share links.",
                    icon: "info.circle",
                    color: Palette.muted2
                )
            }
        case .checking:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Testing")
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
            try await Ingest.save(url: nil, text: "Connection test from the Podcapp app.")
            connection = .ok(String(localized: "Connected. Sharing is ready."))
            Feedback.saved()
        } catch {
            connection = .failed(error.localizedDescription)
            Feedback.refused()
        }
    }

    // MARK: - Langue

    private var languageCard: some View {
        PlainCard(cornerRadius: 16, padding: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Language")
                        .typo(Typo.listTitle)
                        .foregroundStyle(Palette.ink)
                    Text("Interface and narration follow your phone. Change it in iOS Settings.")
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

    // MARK: - Retours

    private var feedbackCard: some View {
        PlainCard(cornerRadius: 16, padding: 0) {
            VStack(spacing: 0) {
                feedbackRow(
                    title: "Haptics",
                    sub: "A tap under your finger on tabs, playback and chapters.",
                    isOn: $haptics
                )
                Rectangle().fill(Palette.cardBorder).frame(height: 1)
                feedbackRow(
                    title: "Sounds",
                    sub: "Four short sounds: saved, refused, generation queued, next chapter.",
                    isOn: $sounds
                )
            }
        }
    }

    private func feedbackRow(title: String, sub: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .typo(Typo.listTitle)
                    .foregroundStyle(Palette.ink)
                Text(sub)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
            Spacer(minLength: 0)
            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(Palette.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
    }

    // Read-only, and honest about it: the app is localised in both, and iOS —
    // not this control — decides which one it resolved to.
    private var languagePicker: some View {
        HStack(spacing: 0) {
            languageOption("FR", selected: !AppLocale.isEnglish)
            languageOption("EN", selected: AppLocale.isEnglish)
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
            GenerationRow(
                label: "Output language",
                sub: "Scripts and narration",
                value: AppLocale.current.localizedString(forLanguageCode: AppLocale.code)?.capitalized ?? AppLocale.code
            ),
            GenerationRow(label: "Target length", sub: "Airtime budget fixed before writing", value: "15 min"),
            GenerationRow(label: "Generation", sub: "Started from the computer", value: "Manual"),
            // States the fact, not a promise: a token can be stored and still be
            // refused, and only the test above knows whether the server takes it.
            GenerationRow(
                label: "Share extension",
                sub: "Share a link from Safari, then pick Podcapp",
                value: isConfigured ? "Token saved" : "Token needed"
            ),
            GenerationRow(label: "Private RSS feed", sub: "Apple Podcasts, Overcast", value: "Not shown"),
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
