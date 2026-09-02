import SwiftUI

// The Settings tab of ios/design/layout.html (<sc-if value="{{ tabSettings }}">).
// Signing in happens once, in onboarding's Sign in with Apple button; this
// screen only ever shows an already-signed-in account -- its own device in
// "Signed-in devices" below, and the way out is Sign out or Delete my
// account, not a token field to edit.
//
// The generation settings below are read-only on purpose: voice, target length
// and the RSS token live on the machine that generates episodes, and the API
// exposes none of them. Inventing values here would be worse than saying so.
struct SettingsView: View {
    // Config is plain UserDefaults and publishes nothing, so the saved state is
    // mirrored here.
    @State private var isConfigured = Config.isConfigured
    // Config publishes nothing, so the switches keep their own state and write
    // through on change.
    @State private var haptics = Config.hapticsEnabled
    @State private var sounds = Config.soundEnabled
    // The account as the server sees it: voice, language, feed link. Loaded
    // once per visit; nil until then, and the cards that need it wait.
    @State private var me: API.Me?
    @State private var showingShareHelp = false
    @State private var copiedFeed = false
    // The devices signed into this account. Loaded once per visit, same as `me`.
    // A separate state so a network hiccup does not read as "no other devices".
    @State private var devicesState: DevicesState = .loading
    private enum DevicesState {
        case loading
        case loaded([DeviceSession])
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

                if isConfigured {
                    devicesSection
                        .padding(.bottom, 22)
                }

                languageCard
                    .padding(.bottom, 12)

                if me != nil {
                    voiceCard
                        .padding(.bottom, 12)
                }

                feedbackCard
                    .padding(.bottom, 12)

                Text("The language follows your phone and the voice is yours to pick; the rest is decided by the pipeline.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)

                generationCard

                shareHelpCard
                    .padding(.top, 12)

                Text("The RSS feed works in Apple Podcasts, Overcast and the rest. Its address carries a token that is the only key to your episodes: share it with nobody.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 14)
                    .padding(.horizontal, 4)

                HStack(spacing: 18) {
                    privacyLink
                    replayLink
                }
                .padding(.top, 20)
                .padding(.horizontal, 4)

                signOutButton
                    .padding(.top, 28)
                    .padding(.horizontal, 4)

                deleteAccountButton
                    .padding(.top, 14)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .task { me = try? await API.shared.me() }
        .sheet(isPresented: $showingShareHelp) { ShareHelpSheet() }
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
    // not only from the App Store listing. It follows Config.baseURL, so a
    // build pointed elsewhere reads that server's policy rather than a
    // hardcoded one.
    @ViewBuilder
    private var privacyLink: some View {
        let base = Config.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
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

    // MARK: - Appareils connectes

    private var devicesSection: some View {
        PlainCard(cornerRadius: 16, padding: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Signed-in devices")
                    .typo(Typo.listTitle)
                    .foregroundStyle(Palette.ink)
                switch devicesState {
                case .loading:
                    EmptyView()
                case let .loaded(devices):
                    VStack(spacing: 0) {
                        ForEach(Array(devices.enumerated()), id: \.element.id) { index, device in
                            deviceRow(device)
                            if index < devices.count - 1 {
                                Rectangle().fill(Palette.hairline).frame(height: 1)
                            }
                        }
                    }
                case let .failed(message):
                    Text(message)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.danger)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
        }
        .task { await loadDevices() }
    }

    // Every "iPhone" in this list can look identical -- UIDevice.current.name
    // returns that generic label on iOS 16+ without a dedicated entitlement
    // (see Auth.deviceName) -- so last-seen time and the current-device marker
    // are what actually let someone tell the rows apart before picking one to
    // revoke.
    private func deviceRow(_ device: DeviceSession) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(device.device_name)
                        .typo(Typo.rowTitle)
                        .foregroundStyle(Palette.ink)
                    if device.current {
                        Text("This device")
                            .textCase(.uppercase)
                            .typo(Typo.chip)
                            .foregroundStyle(Palette.muted)
                    }
                }
                Text(Self.lastSeenLabel(device.last_seen_at))
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
            Spacer(minLength: 0)
            Button {
                Task { await revoke(device) }
            } label: {
                // "Sign out" is reserved for the standalone button below,
                // which always acts on this device's own session: a row can
                // point at someone else's, so "Revoke" is what stays true
                // regardless of which row it is on.
                Text("Revoke")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .underline()
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 6)
    }

    // A row can be this device's own session: revoking it the same way as any
    // other row would race the reload just below against a 401 walking this
    // device back to onboarding on its own. Routing through Auth.signOut()
    // instead makes that deterministic -- server revoke, then local clear --
    // and it is the same call the standalone Sign out button makes.
    private func revoke(_ device: DeviceSession) async {
        if device.current {
            await Auth.signOut()
            return
        }
        try? await API.shared.revokeSession(id: device.id)
        await loadDevices()
    }

    private func loadDevices() async {
        do {
            devicesState = .loaded(try await API.shared.sessions())
        } catch {
            devicesState = .failed(error.localizedDescription)
        }
    }

    // Today shows a time, any other day shows day + month -- same split
    // LibraryRow.stamp uses for capturedAt, so a saved source and a device's
    // last-seen read the same way.
    private static let lastSeenTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let lastSeenDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter
    }()

    private static func lastSeenLabel(_ date: Date) -> String {
        let stamp = Calendar.current.isDateInToday(date) ? lastSeenTime.string(from: date) : lastSeenDay.string(from: date)
        return String(localized: "Last seen \(stamp)")
    }

    // MARK: - Deconnexion

    private var signOutButton: some View {
        Button {
            signOut()
        } label: {
            Text("Sign out")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .underline()
        }
        .buttonStyle(.plain)
        .disabled(!isConfigured)
    }

    private func signOut() {
        Feedback.tap()
        Task { await Auth.signOut() }
    }

    // MARK: - Suppression du compte

    @State private var confirmingDeletion = false
    @State private var deletion: Deletion = .idle
    enum Deletion: Equatable { case idle, working, failed(String) }

    // App Review 5.1.1(v): an account you can sign into is an account you can
    // delete from inside the app. It is also what makes the privacy policy's
    // "erasure is final" a fact rather than a promise kept by hand.
    private var deleteAccountButton: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                confirmingDeletion = true
            } label: {
                Text(deletion == .working ? String(localized: "Deleting…") : String(localized: "Delete my account"))
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
                    .underline()
            }
            .buttonStyle(.plain)
            .disabled(deletion == .working || !isConfigured)
            if case let .failed(message) = deletion {
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
            }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your sources, briefings, audio and feed are erased for good. Nothing is kept.")
        }
    }

    @MainActor
    private func deleteAccount() async {
        deletion = .working
        do {
            try await API.shared.deleteAccount()
            // The server has already revoked every session and both tokens
            // for this account (see DELETE /me): nothing left to tell it, so
            // this is the same local-only clear the 401 path uses, not
            // Auth.signOut() -- that would just spend a network call getting
            // a 401 back for a session already dead.
            Config.endSession()
            deletion = .idle
            Feedback.saved()
        } catch {
            deletion = .failed(error.localizedDescription)
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

    // MARK: - Voix

    /// The narrator, per language: only the voices the server lists for the
    /// interface language, and the pick is stored on the account so the 06:00
    /// cron uses it too. "Previewed on the next generation" is the honest
    /// promise: there is no sample player here, the next episode is the sample.
    private var voiceCard: some View {
        let options = voiceOptions
        return PlainCard(cornerRadius: 16, padding: 0) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Narration voice")
                        .typo(Typo.listTitle)
                        .foregroundStyle(Palette.ink)
                    Text("ElevenLabs · previewed on the next generation")
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                }
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(options) { option in
                            voiceChip(option, selected: option.id == selectedVoiceId)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
        }
    }

    private var voiceOptions: [API.VoiceOption] {
        guard let me else { return [] }
        let forInterface = me.voices.filter { $0.language == AppLocale.code }
        return forInterface.isEmpty ? me.voices.filter { $0.language == me.language } : forInterface
    }

    private var selectedVoiceId: String? { me?.voiceId ?? me?.voice }

    private func voiceChip(_ option: API.VoiceOption, selected: Bool) -> some View {
        Button {
            guard !selected else { return }
            Feedback.select()
            Task {
                do {
                    me = try await API.shared.updateVoice(option.id)
                    Feedback.saved()
                } catch {
                    Feedback.refused()
                }
            }
        } label: {
            VStack(spacing: 2) {
                Text(option.name)
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(selected ? Palette.onDark : Palette.ink)
                Text(option.style)
                    .typo(Typo.metaTiny)
                    .foregroundStyle(selected ? Palette.onDark.opacity(0.7) : Palette.muted2)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(selected ? Palette.ink : Palette.cardFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.cardBorder, lineWidth: selected ? 0 : 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Aide au partage, intro

    private var shareHelpCard: some View {
        Button { showingShareHelp = true } label: {
            PlainCard(cornerRadius: 16, padding: 0) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("How to share a link in Podcapp")
                            .typo(Typo.listTitle)
                            .foregroundStyle(Palette.ink)
                        Text("The gesture, in 3 steps")
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.muted2)
                    }
                    Spacer(minLength: 0)
                    Text("›")
                        .typo(Typo.navButton)
                        .foregroundStyle(Palette.muted2)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 15)
            }
        }
        .buttonStyle(.plain)
    }

    private var replayLink: some View {
        Button {
            Feedback.tap()
            NotificationCenter.default.post(name: .podcappReplayOnboarding, object: nil)
        } label: {
            Text("Replay the intro")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .underline()
        }
        .buttonStyle(.plain)
    }

    private func copyFeedLink() {
        guard let url = me?.feedURL else { return }
        UIPasteboard.general.string = url.absoluteString
        copiedFeed = true
        Feedback.saved()
        Task {
            try? await Task.sleep(for: .seconds(2))
            copiedFeed = false
        }
    }

    // MARK: - Retours

    private var feedbackCard: some View {
        PlainCard(cornerRadius: 16, padding: 0) {
            VStack(spacing: 0) {
                feedbackRow(
                    title: String(localized: "Haptics"),
                    sub: String(localized: "A tap under your finger on tabs, playback and chapters."),
                    isOn: $haptics
                )
                Rectangle().fill(Palette.cardBorder).frame(height: 1)
                feedbackRow(
                    title: String(localized: "Sounds"),
                    sub: String(localized: "Four short sounds: saved, refused, generation queued, next chapter."),
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
        var action: (() -> Void)? = nil

        var id: String { label }
    }

    private var generationRows: [GenerationRow] {
        [
            GenerationRow(
                label: String(localized: "Output language"),
                sub: String(localized: "Scripts and narration"),
                value: AppLocale.current.localizedString(forLanguageCode: me?.language ?? AppLocale.code)?.capitalized ?? (me?.language ?? AppLocale.code)
            ),
            GenerationRow(
                label: String(localized: "Target length"),
                sub: String(localized: "Airtime budget fixed before writing"),
                value: me.map { String(localized: "\($0.targetMinutes) min · max \($0.maxMinutes)") } ?? String(localized: "5 min max")
            ),
            GenerationRow(label: String(localized: "Generation"), sub: String(localized: "Every morning at 6:00, or from Today"), value: me.map { "\($0.dailyAt) · " + String(localized: "On") } ?? String(localized: "Daily")),
            // isConfigured is true from the moment Sign in with Apple succeeds
            // until Sign out or Delete my account, so this states a fact about
            // the signed-in session, not a promise about a pasted value.
            GenerationRow(
                label: String(localized: "Share extension"),
                sub: String(localized: "Share a link from Safari, then pick Podcapp"),
                value: isConfigured ? String(localized: "Token saved") : String(localized: "Token needed")
            ),
            GenerationRow(
                label: String(localized: "Private RSS feed"),
                sub: String(localized: "Apple Podcasts, Overcast"),
                value: me?.feedURL == nil ? String(localized: "Published") : (copiedFeed ? String(localized: "Copied") : String(localized: "Copy link")),
                action: me?.feedURL == nil ? nil : { copyFeedLink() }
            ),
        ] + (me?.ingestAddress.map { address in
            [GenerationRow(
                label: String(localized: "Ingest address"),
                sub: String(localized: "Forward newsletters here"),
                value: address,
                action: { UIPasteboard.general.string = address; Feedback.saved() }
            )]
        } ?? [])
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

    @ViewBuilder
    private func generationRowView(_ row: GenerationRow) -> some View {
        if let action = row.action {
            Button(action: action) { generationRowBody(row) }
                .buttonStyle(.plain)
        } else {
            generationRowBody(row)
        }
    }

    private func generationRowBody(_ row: GenerationRow) -> some View {
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

// MARK: - Previews

#Preview("Réglages") {
    SettingsView()
}
