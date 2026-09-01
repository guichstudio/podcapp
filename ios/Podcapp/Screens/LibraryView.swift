import SwiftUI

// The Sources tab: everything captured, what the pipeline made of it, and the
// reason when it went wrong. Layout and copy come from ios/design/layout.html
// and component.jsx (TXT.fr, CHIP_L.fr, ACT_FR, LBL_FR).

struct LibraryView: View {
    @State private var sources: [SavedSource] = []
    @State private var phase: Phase = .loading
    @State private var filter: LibraryFilter = .all
    @State private var expanded: String?
    @State private var draft = ""
    @State private var addState: AddState = .idle

    private enum Phase {
        case loading, loaded, failed(String)
    }

    private enum AddState {
        case idle, sending, done(String), failed(String)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Sources")
                    .typo(Typo.screenTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 6)
                    .padding(.bottom, 14)

                captureField
                filterPills
                content
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(ScreenBackground())
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: - Capture

    private var captureField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("Paste a link or some text…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .font(Typo.font(size: 13, weight: .regular))
                    .foregroundStyle(Palette.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 11)
                    .background(Palette.cardFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(Palette.cardBorder, lineWidth: 1)
                    )
                    .onSubmit { Task { await add() } }

                Button {
                    Task { await add() }
                } label: {
                    Group {
                        if case .sending = addState {
                            ProgressView().tint(Palette.onDark)
                        } else {
                            Text("Add")
                                .font(Typo.font(size: 13, weight: .semibold))
                        }
                    }
                    .foregroundStyle(Palette.onDark)
                    .frame(height: 41)
                    .padding(.horizontal, 16)
                    .background(Palette.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .disabled(isAddDisabled)
                .opacity(isAddDisabled ? 0.45 : 1)
            }

            switch addState {
            case .idle, .sending:
                EmptyView()
            case let .done(message):
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.success)
            case let .failed(message):
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
            }
        }
        .padding(.bottom, 14)
    }

    private var isAddDisabled: Bool {
        if case .sending = addState { return true }
        return draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filterPills: some View {
        HStack(spacing: 6) {
            ForEach(LibraryFilter.allCases) { option in
                Button {
                    filter = option
                    expanded = nil
                } label: {
                    Text(option.label)
                        .typo(Typo.buttonSmall)
                        .foregroundStyle(option == filter ? Palette.onDark : Palette.body)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(option == filter ? Palette.ink : Palette.airedChipBg, in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.cardBorder, lineWidth: 1))
                }
            }
        }
    }

    // MARK: - List

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            message(title: "Loading your sources…", detail: nil, showsSpinner: true)
        case let .failed(reason):
            message(title: "Could not load", detail: reason, showsSpinner: false)
        case .loaded:
            if sources.isEmpty {
                message(
                    title: "No source saved yet.",
                    detail: "Share a link from Safari with Podcapp, or paste it above.",
                    showsSpinner: false
                )
            } else if sections.isEmpty {
                message(
                    title: "Nothing in this filter.",
                    detail: "\(sources.count) saved in total: tap All to see them.",
                    showsSpinner: false
                )
            } else {
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 0) {
                        Overline(text: section.title)
                            .padding(.top, 20)
                            .padding(.bottom, 4)
                        ForEach(section.rows) { source in
                            row(source)
                        }
                    }
                }
            }
        }
    }

    private func message(title: String, detail: String?, showsSpinner: Bool) -> some View {
        PlainCard(cornerRadius: 14, padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if showsSpinner { ProgressView().tint(Palette.muted) }
                    Text(title)
                        .typo(Typo.rowTitleStrong)
                        .foregroundStyle(Palette.ink)
                }
                if let detail {
                    Text(detail)
                        .typo(Typo.detail)
                        .foregroundStyle(Palette.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 20)
    }

    private func row(_ source: SavedSource) -> some View {
        let state = LibraryStatus.of(source)
        let isOpen = expanded == source.id

        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text(state.icon)
                    .font(Typo.font(size: 13, weight: .regular))
                    .foregroundStyle(Palette.body)
                    .frame(width: 36, height: 36)
                    .background(Palette.airedChipBg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(LibraryRow.publisher(source))
                        .textCase(.uppercase)
                        .typo(Typo.sourcePub)
                        .foregroundStyle(Palette.muted2)
                        .lineLimit(1)
                    Text(LibraryRow.title(source))
                        .typo(Typo.listTitle)
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(LibraryRow.meta(source))
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted2)
                        .padding(.top, 1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                StatusChip(label: state.chip, kind: state.kind)
                    .padding(.top, 2)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeInOut(duration: 0.18)) {
                    expanded = isOpen ? nil : source.id
                }
            }

            if isOpen {
                PlainCard(cornerRadius: 13, padding: 12) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(LibraryRow.detail(source))
                            .typo(Typo.detail)
                            .foregroundStyle(Palette.body)
                            .fixedSize(horizontal: false, vertical: true)

                        if !state.actions.isEmpty {
                            // No endpoint backs these yet: a dead button that looks
                            // alive is worse than a named limitation.
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    ForEach(state.actions, id: \.self) { action in
                                        Text(action)
                                            .typo(Typo.buttonSmall)
                                            .foregroundStyle(Palette.faint)
                                            .lineLimit(1)
                                            .padding(.horizontal, 13)
                                            .padding(.vertical, 8)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                                    .strokeBorder(Palette.cardBorder, lineWidth: 1)
                                            )
                                    }
                                }
                                Text("Unavailable: the server does not expose these actions yet.")
                                    .typo(Typo.metaTiny)
                                    .foregroundStyle(Palette.faint)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, 48)
                .padding(.top, 10)
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
    }

    // MARK: - Data

    private var sections: [LibrarySection] {
        let visible = sources.filter { filter.keeps(LibraryStatus.of($0)) }
        let problems = visible.filter { LibraryStatus.of($0).isProblem }
        let healthy = visible.filter { !LibraryStatus.of($0).isProblem }
        let calendar = Calendar.current

        return [
            LibrarySection(
                id: "today",
                title: "TODAY",
                rows: healthy.filter { calendar.isDateInToday($0.capturedAt) }
            ),
            LibrarySection(id: "issues", title: "NEEDS A LOOK", rows: problems),
            LibrarySection(
                id: "earlier",
                title: "EARLIER",
                rows: healthy.filter { !calendar.isDateInToday($0.capturedAt) }
            ),
        ].filter { !$0.rows.isEmpty }
    }

    private func load() async {
        do {
            sources = try await API.shared.sources()
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func add() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        addState = .sending
        do {
            try await Ingest.save(url: LibraryRow.link(from: text), text: text)
            draft = ""
            addState = .done(String(localized: "Saved. It will join your next briefing."))
            Feedback.saved()
            await load()
        } catch {
            addState = .failed(error.localizedDescription)
            Feedback.refused()
        }
    }
}

// MARK: - Filters, sections, status mapping

private enum LibraryFilter: String, CaseIterable, Identifiable {
    case all, ready, issues

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return String(localized: "All")
        case .ready: return String(localized: "Ready")
        case .issues: return String(localized: "Issues")
        }
    }

    func keeps(_ status: LibraryStatus) -> Bool {
        switch self {
        case .all: return true
        case .ready: return status.isReady
        case .issues: return status.isProblem
        }
    }
}

private struct LibrarySection: Identifiable {
    let id: String
    let title: String
    let rows: [SavedSource]
}

/// One row's status, translated from `sources.status` in src/db/schema.ts.
/// Chip wording comes from CHIP_L.fr, the actions from ACT_FR.
private struct LibraryStatus {
    let chip: String
    let kind: StatusChip.Kind
    let icon: String
    let isReady: Bool
    let isProblem: Bool
    let actions: [String]

    static func of(_ source: SavedSource) -> LibraryStatus {
        switch source.status {
        case "received":
            // The queue drains on the laptop, so this is where a fresh capture
            // rests: normal, not a failure.
            return LibraryStatus(
                chip: "EN FILE", kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false, actions: ["Supprimer"]
            )
        case "extracting":
            return LibraryStatus(
                chip: "EXTRACTION", kind: .warning, icon: glyph(source),
                isReady: false, isProblem: false, actions: ["Supprimer"]
            )
        case "analyzed":
            return LibraryStatus(
                chip: "ANALYSÉ", kind: .neutral, icon: glyph(source),
                isReady: true, isProblem: false,
                actions: ["Exclure du prochain épisode", "Supprimer"]
            )
        case "ready":
            return LibraryStatus(
                chip: "PRÊT", kind: .success, icon: glyph(source),
                isReady: true, isProblem: false,
                actions: ["Exclure du prochain épisode", "Supprimer"]
            )
        case "duplicate":
            return LibraryStatus(
                chip: "DOUBLON", kind: .neutral, icon: "⧉",
                isReady: false, isProblem: true, actions: ["Ignorer"]
            )
        case "extraction_failed", "low_quality", "unsupported":
            // Three ways to end up without usable text; the row's error line says
            // which one, so they share the one chip the design gives them.
            return LibraryStatus(
                chip: "ÉCHEC", kind: .danger, icon: "⚠",
                isReady: false, isProblem: true,
                actions: ["Relancer l’extraction", "Supprimer"]
            )
        default:
            return LibraryStatus(
                chip: source.status.uppercased(), kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false, actions: []
            )
        }
    }

    private static func glyph(_ source: SavedSource) -> String {
        source.type == "email" ? "✉" : "¶"
    }
}

// MARK: - Row copy

private enum LibraryRow {
    static func publisher(_ source: SavedSource) -> String {
        if let publisher = source.publisher, !publisher.isEmpty { return publisher }
        if let host = source.link?.host { return host }
        return source.type
    }

    static func title(_ source: SavedSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let url = source.url, !url.isEmpty { return url }
        return String(localized: "Untitled")
    }

    static func meta(_ source: SavedSource) -> String {
        var parts = [source.type]
        if let lang = source.lang, !lang.isEmpty { parts.append(lang.uppercased()) }
        parts.append(stamp(source.capturedAt))
        if let quality = source.extractionQuality {
            parts.append("qualité " + decimal(quality))
        }
        return parts.joined(separator: " · ")
    }

    /// The sentence under an expanded row. The server's own `error` wins over any
    /// wording of ours: it is the only text that says what actually broke.
    static func detail(_ source: SavedSource) -> String {
        if let error = source.error, !error.isEmpty { return error }
        switch source.status {
        case "received":
            return String(localized: "Queued. Extraction runs at the next pass.")
        case "extracting":
            return String(localized: "Extracting…")
        case "analyzed":
            return source.inStory
                ? "Analysé et rattaché à un sujet."
                : "Analysé, en attente de regroupement."
        case "ready":
            return source.inStory
                ? "Prêt, rattaché à un sujet : candidat au prochain briefing."
                : "Prêt pour le prochain briefing."
        case "duplicate":
            return String(localized: "Already saved: counted once.")
        case "extraction_failed", "low_quality", "unsupported":
            return String(localized: "Extraction failed, with no detail from the server.")
        default:
            return String(localized: "Status “\(source.status)” unknown to the app.")
        }
    }

    /// `{url}` and `{text}` are different payloads at /ingest, so a pasted link
    /// must be recognised as one rather than saved as prose.
    static func link(from text: String) -> URL? {
        let lowered = text.lowercased()
        guard lowered.hasPrefix("http://") || lowered.hasPrefix("https://") else { return nil }
        guard let url = URL(string: text), url.host != nil else { return nil }
        return url
    }

    private static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter
    }()

    private static func stamp(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? time.string(from: date) : day.string(from: date)
    }

    private static func decimal(_ value: Double) -> String {
        String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",")
    }
}
