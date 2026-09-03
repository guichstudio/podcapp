import SwiftUI
import UIKit

// The Settings tab of the v3 prototype (ios/design/v3-layout.html): a stack of
// blurred glass groups 12pt apart -- a language card, the voice picker, the
// read-only rows, the how-to-share row -- with footnotes and underlined links
// between them.
//
// Signing in happens once, in onboarding's Sign in with Apple button; this
// screen only ever shows an already-signed-in account -- its own device in
// "Signed-in devices" below, and the way out is Sign out or Delete my
// account, not a token field to edit.
//
// The generation settings below are read-only on purpose: voice, target length
// and the RSS token live on the machine that generates episodes, and the API
// exposes none of them. Inventing values here would be worse than saying so.
// Where the prototype offers a control the API cannot serve -- an EN/FR switch,
// a 15-minute length, a schedule toggle -- only its visual treatment is kept
// and the app's own fact is shown in it.
struct SettingsView: View {
    @Environment(\.openURL) private var openURL
    // Config is plain UserDefaults and publishes nothing, so the saved state is
    // mirrored here.
    @State private var isConfigured = Config.isConfigured
    // Config publishes nothing, so the switches keep their own state and write
    // through on change.
    @State private var haptics = Config.hapticsEnabled
    @State private var sounds = Config.soundEnabled
    // The account as the server sees it: voice, language, feed link. Loaded
    // once per visit, same shape as `devicesState` below so a failed load
    // reads as an error rather than as an account with nothing in it.
    @State private var meState: MeState = .loading
    private enum MeState {
        case loading
        case loaded(API.Me)
        case failed(String)
    }
    private var me: API.Me? {
        if case let .loaded(value) = meState { return value }
        return nil
    }
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

                languageCard
                    .padding(.bottom, 12)

                if me != nil {
                    voiceCard
                        .padding(.bottom, 12)
                }

                feedbackCard
                    .padding(.bottom, 12)

                generationCard

                if case let .failed(message) = meState {
                    // Without this, the rows above quietly fall back to
                    // placeholder values with nothing saying they are not the
                    // account's real settings.
                    footnote(Text(message), color: Palette.danger)
                }

                footnote(Text("The language follows your phone and the voice is yours to pick; the rest is decided by the pipeline."))

                shareHelpCard
                    .padding(.top, 12)

                footnote(Text("The RSS feed works in Apple Podcasts, Overcast and the rest. Its address carries a token that is the only key to your episodes: share it with nobody."))

                // The prototype has no account section -- it predates sign-in --
                // so the devices list borrows the voice card's shape: a header
                // over hairline-separated rows.
                if isConfigured {
                    devicesSection
                        .padding(.top, 22)
                }

                accountLinks
                    .padding(.top, 16)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 2)
            .padding(.bottom, 24)
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .task {
            do {
                meState = .loaded(try await API.shared.me())
            } catch {
                meState = .failed(error.localizedDescription)
            }
        }
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

    // MARK: - Pieces the prototype repeats

    /// The prototype's settings group: `rgba(255,255,255,.52)` over a 26px
    /// backdrop filter, a white hairline, radius 16 and the ambient card
    /// shadow. Local to this screen because `PlainCard` is the opaquer card
    /// the story and episode lists use, and other screens depend on it as it
    /// is.
    private struct SettingsCard<Content: View>: View {
        @ViewBuilder var content: Content

        private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: Radius.group, style: .continuous) }

        var body: some View {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    shape.glass(Palette.panelFill, .filtered)
                }
                // Rows draw their separators edge to edge; the clip is what
                // keeps them off the rounded corners.
                .clipShape(shape)
                .overlay {
                    // CSS pairs the drop shadow with `inset 0 1px 0 white`.
                    // SwiftUI has no inset shadow, so the border itself fades
                    // from that highlight at the top to its base alpha, the
                    // same trick the tab bar uses.
                    shape.strokeBorder(Palette.glassEdge(Palette.panelBorder), lineWidth: 1)
                }
                .dropShadow(Palette.cardShadow)
        }
    }

    /// The 15/16 padding every row and card body in the prototype uses.
    private func rowPadding<V: View>(_ content: V) -> some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
    }

    private func hairline() -> some View {
        Rectangle().fill(Palette.hairline).frame(height: 1)
    }

    /// The grey note that sits between two groups, inset 4pt like the prototype's.
    private func footnote(_ text: Text, color: Color = Palette.muted2) -> some View {
        text
            .typo(Typo.note)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 14)
            .padding(.horizontal, 4)
    }

    /// The prototype's only link style: 12.5pt semibold, underlined, violet.
    /// Sign out and Delete take the same shape in their own colour, so the
    /// footer reads as one family rather than four inventions.
    private func linkLabel(_ text: Text, color: Color = Palette.accentDeep) -> some View {
        text
            .typo(Typo.buttonMedium)
            .foregroundStyle(color)
            .underline()
            // The prototype's "Replay intro" carries `padding: 10px 4px`; the
            // horizontal half lives on the footer stack, which insets all of
            // these links together.
            .padding(.vertical, 10)
            .contentShape(Rectangle())
    }

    // MARK: - Langue

    private var languageCard: some View {
        SettingsCard {
            rowPadding(
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Language")
                            .typo(Typo.rowLabel)
                            .foregroundStyle(Palette.ink)
                        Text("Interface and narration follow your phone. Change it in iOS Settings.")
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.muted2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    languagePicker
                }
            )
        }
    }

    // It was a readout, on the reasoning that iOS decides which localisation
    // resolved and the API has no language field to write. But the prototype's
    // segmented capsule with one half filled reads as a switch no matter what
    // the code intends -- the owner tapped it and reported it broken, which is
    // the only test that counts. A control that looks actionable and does
    // nothing is the same defect as the "Included" pill this app already
    // removed for App Review.
    //
    // So it acts: tapping opens this app's page in iOS Settings, which is
    // exactly where the language really can be changed. The shape keeps the
    // prototype's weight and now tells the truth about itself.
    private var languagePicker: some View {
        Button {
            Feedback.tap()
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
            HStack(spacing: 0) {
                languageOption("EN", selected: AppLocale.isEnglish)
                languageOption("FR", selected: !AppLocale.isEnglish)
            }
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Palette.controlBorder, lineWidth: 1))
            .fixedSize()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Language"))
        .accessibilityHint(Text("Interface and narration follow your phone. Change it in iOS Settings."))
    }

    private func languageOption(_ label: String, selected: Bool) -> some View {
        Text(label)
            .typo(Typo.buttonSmall)
            .foregroundStyle(selected ? Palette.onDark : Palette.body)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(selected ? Palette.ink : Color.clear)
    }

    // MARK: - Voix

    /// The narrator, per language: only the voices the server lists for the
    /// interface language, and the pick is stored on the account so the 06:00
    /// cron uses it too. "Previewed on the next generation" is the honest
    /// promise: there is no sample player here, the next episode is the sample.
    private var voiceCard: some View {
        let options = voiceOptions
        return SettingsCard {
            rowPadding(
                VStack(alignment: .leading, spacing: 11) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Narration voice")
                            .typo(Typo.rowLabel)
                            .foregroundStyle(Palette.ink)
                        Text("ElevenLabs · previewed on the next generation")
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.muted2)
                    }
                    // The server offers three English voices and two French
                    // ones, so the prototype's equal-width row always fits and
                    // never needs to scroll.
                    HStack(spacing: 7) {
                        ForEach(options) { option in
                            voiceTile(option, selected: option.id == selectedVoiceId)
                        }
                    }
                }
            )
        }
    }

    private var voiceOptions: [API.VoiceOption] {
        guard let me else { return [] }
        let forInterface = me.voices.filter { $0.language == AppLocale.code }
        return forInterface.isEmpty ? me.voices.filter { $0.language == me.language } : forInterface
    }

    private var selectedVoiceId: String? { me?.voiceId ?? me?.voice }

    private func voiceTile(_ option: API.VoiceOption, selected: Bool) -> some View {
        Button {
            guard !selected else { return }
            Feedback.select()
            Task {
                do {
                    meState = .loaded(try await API.shared.updateVoice(option.id))
                    Feedback.saved()
                } catch {
                    Feedback.refused()
                }
            }
        } label: {
            VStack(spacing: 2) {
                Text(option.name)
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(selected ? Palette.onDark : Palette.body)
                Text(option.style)
                    .typo(Typo.tileCaption)
                    .foregroundStyle(selected ? Palette.onDarkMuted : Palette.muted2)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 6)
            .padding(.vertical, 9)
            .background(
                selected ? AnyShapeStyle(Palette.ink) : AnyShapeStyle(Palette.pillFill),
                in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
            )
            // The outline stays on the selected tile too, exactly as the
            // prototype draws it -- it is what keeps the dark tile from
            // looking a pixel larger than its neighbours.
            .overlay(
                RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
                    .strokeBorder(Palette.tileBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(option.name))
        .accessibilityValue(Text(option.style))
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    // MARK: - Retours

    private var feedbackCard: some View {
        SettingsCard {
            VStack(spacing: 0) {
                feedbackRow(
                    title: String(localized: "Haptics"),
                    sub: String(localized: "A tap under your finger on tabs, playback and chapters."),
                    isOn: $haptics
                )
                hairline()
                feedbackRow(
                    title: String(localized: "Sounds"),
                    sub: String(localized: "Four short sounds: saved, refused, generation queued, next chapter."),
                    isOn: $sounds
                )
            }
        }
    }

    private func feedbackRow(title: String, sub: String, isOn: Binding<Bool>) -> some View {
        rowPadding(
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .typo(Typo.rowLabel)
                        .foregroundStyle(Palette.ink)
                    Text(sub)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: isOn)
                    .labelsHidden()
                    .tint(Palette.ink)
                    .accessibilityLabel(Text(title))
            }
        )
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
        return SettingsCard {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    generationRowView(row)
                    if index < rows.count - 1 {
                        hairline()
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
        rowPadding(
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.label)
                        .typo(Typo.rowLabel)
                        .foregroundStyle(Palette.ink)
                    Text(row.sub)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                // One line, cut with an ellipsis, the way the prototype writes
                // its own address ("ingest+louis@..."). Letting it wrap leaves
                // the tail of the address alone on a second line, under a row
                // built to be read left label / right value.
                Text(row.value)
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        )
    }

    // MARK: - Aide au partage

    private var shareHelpCard: some View {
        Button { showingShareHelp = true } label: {
            SettingsCard {
                rowPadding(
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("How to share a link in Podcapp")
                                .typo(Typo.rowLabel)
                                .foregroundStyle(Palette.ink)
                            Text("The gesture, in 3 steps")
                                .typo(Typo.metaSmall)
                                .foregroundStyle(Palette.muted2)
                        }
                        Spacer(minLength: 0)
                        Text(verbatim: "›")
                            .typo(Self.chevron)
                            // Same grey the tab bar's idle labels use; the
                            // prototype writes #8A87A0 in both places.
                            .foregroundStyle(Palette.tabInactive)
                    }
                )
            }
        }
        .buttonStyle(.plain)
    }

    /// 15pt regular: the disclosure arrow's size, which no shared role covers.
    private static let chevron = TypoStyle(size: 15, weight: .regular)

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

    // MARK: - Appareils connectes

    private var devicesSection: some View {
        SettingsCard {
            rowPadding(
                // Spacing 0 and the 11pt carried by each branch: a stack that
                // spaces its children would keep that gap while the list is
                // still loading, leaving the header floating over a band of
                // empty card.
                VStack(alignment: .leading, spacing: 0) {
                    Text("Signed-in devices")
                        .typo(Typo.rowLabel)
                        .foregroundStyle(Palette.ink)
                    switch devicesState {
                    case .loading:
                        EmptyView()
                    case let .loaded(devices):
                        if !devices.isEmpty {
                            VStack(spacing: 0) {
                                ForEach(Array(devices.enumerated()), id: \.element.id) { index, device in
                                    deviceRow(device)
                                    if index < devices.count - 1 {
                                        hairline()
                                    }
                                }
                            }
                            .padding(.top, 11)
                        }
                    case let .failed(message):
                        Text(message)
                            .typo(Typo.note)
                            .foregroundStyle(Palette.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 11)
                    }
                }
            )
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
                        .typo(Typo.rowLabel)
                        .foregroundStyle(Palette.ink)
                    if device.current {
                        // A chip rather than loose grey text: the prototype
                        // marks a row's status with the same pill everywhere.
                        StatusChip(label: String(localized: "This device"), kind: .neutral)
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
                // "Sign out" is reserved for the standalone link below,
                // which always acts on this device's own session: a row can
                // point at someone else's, so "Revoke" is what stays true
                // regardless of which row it is on.
                Text("Revoke")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .underline()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 8)
    }

    // A row can be this device's own session: revoking it the same way as any
    // other row would race the reload just below against a 401 walking this
    // device back to onboarding on its own. Routing through Auth.signOut()
    // instead makes that deterministic -- server revoke, then local clear --
    // and it is the same call the standalone Sign out link makes.
    private func revoke(_ device: DeviceSession) async {
        if device.current {
            await Auth.signOut()
            return
        }
        do {
            try await API.shared.revokeSession(id: device.id)
            await loadDevices()
        } catch {
            // Without this, a failed revoke and a successful one look
            // identical: the row just persists either way.
            devicesState = .failed(error.localizedDescription)
        }
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

    // MARK: - Pied de page : mentions legales, session, compte

    private var accountLinks: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                legalLink(slug: "privacy", label: Text("Privacy policy"))
                legalLink(slug: "terms", label: Text("Terms of Use"))
            }
            replayLink
            signOutButton
            deleteAccountButton
        }
    }

    // App Review 5.1.1 wants the privacy policy reachable from inside the app,
    // not only from the App Store listing, and an app that lets you create an
    // account has to state its terms somewhere a user can find them.
    //
    // These point at the public site rather than at Config.baseURL. The
    // documents belong to the product, not to whichever server instance a build
    // happens to talk to, and the URL is read by people: one that says
    // "vercel.app" reads as a hosting provider's page. The site serves the same
    // two documents, generated from src/legal/ by `pnpm site:legal`, so there
    // is still one source and no copy to drift.
    //
    // The site serves English at the root and French under /fr/, so the link
    // follows the language the app resolved to: reading the terms you agreed
    // to in a language you did not pick is the failure this avoids. Only "fr"
    // is prefixed -- a third localisation added here before the site has its
    // pages would otherwise link to a 404. Trailing slash because the site
    // sets `trailingSlash: true`.
    @ViewBuilder
    private func legalLink(slug: String, label: Text) -> some View {
        let prefix = AppLocale.code == "fr" ? "/fr/" : "/"
        if let url = URL(string: Config.siteURL + prefix + slug + "/") {
            // The underline goes on the Text, not on the Link: on the Link the
            // modifier compiles and does nothing, and a caption-coloured line of
            // text with no affordance does not read as tappable.
            // The colour is set twice on purpose: Link tints its label from the
            // environment, so the outer style is what stops the system blue
            // from winning if the inner one is ever dropped.
            Link(destination: url) { linkLabel(label) }
                .foregroundStyle(Palette.accentDeep)
        }
    }

    private var replayLink: some View {
        Button {
            Feedback.tap()
            NotificationCenter.default.post(name: .podcappReplayOnboarding, object: nil)
        } label: {
            linkLabel(Text("Replay the intro"))
        }
        .buttonStyle(.plain)
    }

    private var signOutButton: some View {
        Button {
            signOut()
        } label: {
            // Neutral rather than violet: leaving the account is not the thing
            // this footer is inviting you to do.
            linkLabel(Text("Sign out"), color: Palette.body)
        }
        .buttonStyle(.plain)
        .disabled(!isConfigured)
    }

    private func signOut() {
        Feedback.tap()
        Task { await Auth.signOut() }
    }

    @State private var confirmingDeletion = false
    @State private var deletion: Deletion = .idle
    enum Deletion: Equatable { case idle, working, failed(String) }

    // App Review 5.1.1(v): an account you can sign into is an account you can
    // delete from inside the app. It is also what makes the privacy policy's
    // "erasure is final" a fact rather than a promise kept by hand.
    private var deleteAccountButton: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                confirmingDeletion = true
            } label: {
                linkLabel(
                    Text(deletion == .working ? String(localized: "Deleting…") : String(localized: "Delete my account")),
                    color: Palette.danger
                )
            }
            .buttonStyle(.plain)
            .disabled(deletion == .working || !isConfigured)
            if case let .failed(message) = deletion {
                Text(message)
                    .typo(Typo.note)
                    .foregroundStyle(Palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
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
}

// MARK: - Previews

#Preview("Réglages") {
    SettingsView()
}
