import SwiftUI

// The Sources tab: everything captured, what the pipeline made of it, and the
// reason when it went wrong. Layout and copy come from ios/design/layout.html
// and component.jsx (TXT.fr, CHIP_L.fr, ACT_FR, LBL_FR).

struct LibraryView: View {
    @State private var sources: [SavedSource] = []
    // The shelves the server files sources under, and the one being looked at.
    // "all" is not a shelf; it is the absence of a filter.
    @State private var categories: [String] = ["tech", "politics", "history", "science", "finance", "other"]
    @State private var category: String?
    @State private var generation: GenerationTarget?
    @State private var generationError: String?
    // The server's own minimum, same source of truth Today reads it from.
    @State private var minimum = 4
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
                Text("Library")
                    .typo(Typo.screenTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 6)
                    .padding(.bottom, 14)

                captureField
                filterPills
                categoryPills
                categoryGenerate
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

    // MARK: - Shelves

    private static func categoryLabel(_ key: String) -> String {
        switch key {
        case "tech": return String(localized: "Technology")
        case "politics": return String(localized: "Politics")
        case "history": return String(localized: "History")
        case "science": return String(localized: "Science")
        case "finance": return String(localized: "Finance")
        case "other": return String(localized: "Other")
        default: return key.capitalized
        }
    }

    private func count(in shelf: String) -> Int { sources.filter { $0.category == shelf }.count }

    /// Same "ready" the row chip already uses (analysed or ready, never a
    /// duplicate or a failure): the count that actually feeds an episode.
    private func readyCount(in shelf: String) -> Int {
        sources.filter { $0.category == shelf && LibraryStatus.of($0).isReady }.count
    }

    private var categoryPills: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                shelfPill(nil, label: String(localized: "All"), count: sources.count)
                ForEach(categories, id: \.self) { shelf in
                    let n = count(in: shelf)
                    shelfPill(shelf, label: Self.categoryLabel(shelf), count: n)
                        .opacity(n == 0 ? 0.45 : 1)
                }
            }
        }
        .scrollIndicators(.hidden)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    private func shelfPill(_ shelf: String?, label: String, count: Int) -> some View {
        let selected = shelf == category
        return Button {
            if shelf != category { Feedback.select() }
            category = shelf
        } label: {
            Text(count > 0 && shelf != nil ? "\(label) · \(count)" : label)
                .typo(Typo.buttonSmall)
                .foregroundStyle(selected ? Palette.onDark : Palette.body)
                .padding(.horizontal, 13)
                .padding(.vertical, 8)
                .background(selected ? Palette.ink : Palette.cardFill, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.cardBorder, lineWidth: selected ? 0 : 1))
        }
        .buttonStyle(.plain)
    }

    /// "Make a Finance episode": only on a shelf with something on it. Gated
    /// the same way Today gates its own Generate button, so a shelf under the
    /// minimum explains the rule instead of letting the server's raw refusal
    /// be the first the user hears of it.
    @ViewBuilder
    private var categoryGenerate: some View {
        if let shelf = category, count(in: shelf) > 0 {
            let rule = MinimumSourcesRule(count: readyCount(in: shelf), minimum: minimum)
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    Task { await generate(shelf: shelf) }
                } label: {
                    HStack(spacing: 9) {
                        Text("▶").typo(Typo.buttonSmall)
                        Text(String(localized: "Make a \(Self.categoryLabel(shelf)) episode")).typo(Typo.buttonMedium)
                    }
                    .foregroundStyle(Palette.onDark)
                    .padding(.vertical, 11)
                    .padding(.horizontal, 18)
                    .background(Palette.ink.opacity(rule.met ? 1 : 0.55), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!rule.met)

                if !rule.met {
                    Text(rule.explanation)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let generationError {
                    Text(generationError)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 10)
            .sheet(item: $generation) { target in GenerationSheet(episodeId: target.id) }
        }
    }

    @MainActor
    private func generate(shelf: String) async {
        generationError = nil
        do {
            let id = try await API.shared.generateEpisode(targetMin: 5, category: shelf)
            generation = GenerationTarget(id: id)
            Feedback.launched()
        } catch APIError.http(_, let message) where !message.isEmpty {
            generationError = message
            Feedback.refused()
        } catch {
            generationError = error.localizedDescription
            Feedback.refused()
        }
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
            message(title: String(localized: "Loading your sources…"), detail: nil, showsSpinner: true)
        case let .failed(reason):
            message(title: String(localized: "Could not load"), detail: reason, showsSpinner: false)
        case .loaded:
            if sources.isEmpty {
                message(
                    title: String(localized: "No source saved yet."),
                    detail: String(localized: "Share a link from Safari with Podcapp, or paste it above."),
                    showsSpinner: false
                )
            } else if sections.isEmpty {
                message(
                    title: String(localized: "Nothing in this filter."),
                    detail: String(localized: "\(sources.count) saved in total: tap All to see them."),
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

    /// The rows on the shelf being looked at; every row when none is.
    private var shelved: [SavedSource] {
        guard let category else { return sources }
        return sources.filter { $0.category == category }
    }

    private var sections: [LibrarySection] {
        let visible = shelved.filter { filter.keeps(LibraryStatus.of($0)) }
        let problems = visible.filter { LibraryStatus.of($0).isProblem }
        let healthy = visible.filter { !LibraryStatus.of($0).isProblem }
        let calendar = Calendar.current

        return [
            LibrarySection(
                id: "today",
                title: String(localized: "TODAY"),
                rows: healthy.filter { calendar.isDateInToday($0.capturedAt) }
            ),
            LibrarySection(id: "issues", title: String(localized: "NEEDS A LOOK"), rows: problems),
            LibrarySection(
                id: "earlier",
                title: String(localized: "EARLIER"),
                rows: healthy.filter { !calendar.isDateInToday($0.capturedAt) }
            ),
        ].filter { !$0.rows.isEmpty }
    }

    private func load() async {
        do {
            let batch = try await API.shared.sources()
            sources = batch.sources
            if let shelves = batch.categories { categories = shelves }
            if let serverMinimum = batch.minimum { minimum = serverMinimum }
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
/// Chip wording comes from CHIP_L.fr. The design's per-row actions (exclude,
/// delete) have no endpoint and are not drawn: App Review 2.1 does not allow a
/// button that only says it does nothing.
private struct LibraryStatus {
    let chip: String
    let kind: StatusChip.Kind
    let icon: String
    let isReady: Bool
    let isProblem: Bool

    static func of(_ source: SavedSource) -> LibraryStatus {
        switch source.status {
        case "received":
            // The queue drains on the laptop, so this is where a fresh capture
            // rests: normal, not a failure.
            return LibraryStatus(
                chip: String(localized: "QUEUED"), kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false
            )
        case "extracting":
            return LibraryStatus(
                chip: String(localized: "EXTRACTING"), kind: .warning, icon: glyph(source),
                isReady: false, isProblem: false
            )
        case "analyzed":
            return LibraryStatus(
                chip: String(localized: "ANALYSED"), kind: .neutral, icon: glyph(source),
                isReady: true, isProblem: false
            )
        case "ready":
            return LibraryStatus(
                chip: String(localized: "READY"), kind: .success, icon: glyph(source),
                isReady: true, isProblem: false
            )
        case "duplicate":
            return LibraryStatus(
                chip: String(localized: "DUPLICATE"), kind: .neutral, icon: "⧉",
                isReady: false, isProblem: true
            )
        case "extraction_failed", "low_quality", "unsupported":
            // Three ways to end up without usable text; the row's error line says
            // which one, so they share the one chip the design gives them.
            return LibraryStatus(
                chip: String(localized: "FAILED"), kind: .danger, icon: "⚠",
                isReady: false, isProblem: true
            )
        default:
            return LibraryStatus(
                chip: source.status.uppercased(), kind: .neutral, icon: glyph(source),
                isReady: false, isProblem: false
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
            parts.append(String(localized: "quality ") + decimal(quality))
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
                ? String(localized: "Analysed and attached to a story.")
                : String(localized: "Analysed, waiting to be grouped.")
        case "ready":
            return source.inStory
                ? String(localized: "Ready and attached to a story: a candidate for the next briefing.")
                : String(localized: "Ready for the next briefing.")
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
