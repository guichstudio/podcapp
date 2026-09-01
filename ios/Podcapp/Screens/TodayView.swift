import SwiftUI
import UIKit

// The Today tab of ios/design/layout.html: the latest briefing, what is queued
// for the next one, and the episodes before it.
//
// One write: Générer posts to /episodes, which queues the generation in the
// cloud. The server owns every refusal (a briefing already in flight, cloud
// not wired up) and words it in French, so this screen shows its message
// verbatim instead of inventing its own diagnosis.

struct TodayView: View {
    @State private var phase: Phase = .loading
    @State private var backstage: EpisodeDetail?
    @State private var targetMinutes = 10
    // Local only: no endpoint carries an include flag, so a tap never leaves the
    // phone. The line under the row says so.
    @State private var includeOverrides: [String: Bool] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header

                switch phase {
                case .loading:
                    loadingState
                case let .failed(message):
                    errorState(message)
                case let .loaded(data):
                    content(data)
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(ScreenBackground())
        .refreshable { await load(reset: false) }
        .task { await load() }
        .sheet(item: $backstage) { TodayBackstageSheet(detail: $0) }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            TodayLogo(size: 32)
            Text("Podcapp")
                .typo(Typo.wordmark)
                .foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Text(TodayText.weekdayDayMonth(Date()))
                .textCase(.uppercase)
                .typo(Typo.dateLabel)
                .foregroundStyle(Palette.muted)
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
        .padding(.bottom, 18)
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Loading your briefings…")
                .typo(Typo.meta)
                .foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private func errorState(_ message: String) -> some View {
        PlainCard(cornerRadius: 18, padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                Overline(text: String(localized: "Chargement impossible"), color: Palette.danger)
                Text(message)
                    .typo(Typo.detail)
                    .foregroundStyle(Palette.body)
                    .fixedSize(horizontal: false, vertical: true)
                Button { Task { await load() } } label: {
                    Text("Try again")
                        .typo(Typo.buttonMedium)
                        .foregroundStyle(Palette.onDark)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 18)
                        .background(Palette.ink, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ data: TodayData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if let featured = data.featured {
                    TodayHeroCard(
                        episode: featured.episode,
                        detail: featured.detail,
                        onBackstage: { backstage = featured.detail }
                    )
                } else {
                    noEpisodeCard
                }
            }
            .padding(.horizontal, 20)

            focusSection(data)

            TodayGenerateCard(readySourceCount: data.readyCount, targetMinutes: $targetMinutes)
                .padding(.horizontal, 20)
                .padding(.top, 18)

            if !data.past.isEmpty {
                Text("Earlier")
                    .typo(Typo.sectionTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 20)
                    .padding(.top, 26)
                    .padding(.bottom, 6)
                ForEach(data.past) { episode in
                    TodayPastRow(episode: episode)
                        .padding(.horizontal, 20)
                }
            }
        }
    }

    private var noEpisodeCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Overline(text: String(localized: "Aucun briefing"), color: Palette.accentDeep)
                Text("Nothing to listen to yet.")
                    .typo(Typo.heroTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Share a few links from Safari, then hit Generate below: the first episode shows up here as soon as it is ready.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.accentMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func focusSection(_ data: TodayData) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Tomorrow")
                .typo(Typo.sectionTitle)
                .foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Text(TodayText.newTodayLabel(data.newTodayCount))
                .typo(Typo.meta)
                .foregroundStyle(Palette.muted)
        }
        .padding(.horizontal, 20)
        .padding(.top, 26)
        .padding(.bottom, 12)

        if data.focus.isEmpty {
            PlainCard {
                Text("Nothing new since the last briefing. Share a link to Podcapp, from Safari or any app, to feed the next one.")
                    .typo(Typo.detail)
                    .foregroundStyle(Palette.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 20)
        } else {
            // Full-bleed row: the design lets the cards run under both edges.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(data.focus) { source in
                        TodayFocusCard(
                            source: source,
                            isIncluded: isIncluded(source),
                            onToggle: { includeOverrides[source.id] = !isIncluded(source) }
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 4)
            }

            Text("In or out stays on this iPhone: the selection is not sent to the server yet.")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 20)
                .padding(.top, 8)
        }
    }

    private func isIncluded(_ source: SavedSource) -> Bool {
        includeOverrides[source.id] ?? TodayText.canAir(source.status)
    }

    // MARK: - Loading

    @MainActor
    private func load(reset: Bool = true) async {
        if reset { phase = .loading }
        do {
            async let sourcesCall = API.shared.sources()
            let episodes = try await API.shared.episodes()

            // /episodes comes back newest first, so the first ready row is the
            // hero. A user whose only episode is still being made still gets a
            // hero, showing that status rather than an empty screen.
            let newest = episodes.first { $0.status == "ready" } ?? episodes.first
            // The list endpoint carries no source ids; the detail is the only
            // way to know what already aired and what it cited. It depends only
            // on the episodes list, so it runs while /sources is in flight
            // instead of behind it.
            let detailTask = Task { [newest] () -> EpisodeDetail? in
                guard let newest else { return nil }
                return try await API.shared.episode(id: newest.id)
            }
            let sources: [SavedSource]
            do {
                sources = try await sourcesCall
            } catch {
                detailTask.cancel()
                throw error
            }
            var featured: TodayData.Featured?
            if let newest, let detail = try await detailTask.value {
                featured = TodayData.Featured(episode: newest, detail: detail)
            }

            let aired: Set<String> = {
                guard let featured, featured.episode.status == "ready" else { return [] }
                return Set(featured.detail.chapters.flatMap(\.sourceIds))
            }()
            let focus = sources.filter { !aired.contains($0.id) }

            phase = .loaded(
                TodayData(
                    featured: featured,
                    past: episodes.filter { $0.id != featured?.episode.id },
                    focus: focus,
                    readyCount: focus.filter { $0.status == "ready" }.count,
                    newTodayCount: focus.filter { Calendar.current.isDateInToday($0.capturedAt) }.count
                )
            )
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // MARK: - Model

    private enum Phase {
        case loading
        case failed(String)
        case loaded(TodayData)
    }

    private struct TodayData {
        struct Featured {
            let episode: EpisodeSummary
            let detail: EpisodeDetail
        }

        let featured: Featured?
        let past: [EpisodeSummary]
        let focus: [SavedSource]
        let readyCount: Int
        let newTodayCount: Int
    }
}

// MARK: - Hero

private struct TodayHeroCard: View {
    let episode: EpisodeSummary
    let detail: EpisodeDetail
    let onBackstage: () -> Void

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Overline(text: overline, color: Palette.accentDeep)
                    Spacer(minLength: 8)
                    if let seconds = episode.actualSec {
                        Text(TodayText.clock(seconds))
                            .typo(Typo.metaTiny)
                            .foregroundStyle(Palette.accentDeep)
                            .tabularNumerals()
                    }
                }

                Text(TodayText.title(episode.title, createdAt: episode.createdAt))
                    .typo(Typo.heroTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)

                chapterMenu

                if episode.status != "ready" {
                    Text(statusLine)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.accentMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                actions

                Text(footnote)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.accentMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 11)
                    .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 1) }
            }
        }
    }

    private var overline: String {
        let date = TodayText.weekdayDayMonth(episode.createdAt)
        switch episode.status {
        case "ready": return String(localized: "Latest briefing · \(date)")
        case "failed": return String(localized: "Briefing failed · \(date)")
        default: return String(localized: "Briefing in progress · \(date)")
        }
    }

    // The API exposes no per-chapter timing (only the episode's actualSec), so
    // the column the design fills with a duration carries the cited source count
    // rather than a number nobody measured.
    @ViewBuilder
    private var chapterMenu: some View {
        if !detail.chapters.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(detail.chapters.enumerated()), id: \.offset) { index, chapter in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(String(format: "%02d", index + 1))
                            .typo(Typo.navButton)
                            .foregroundStyle(Palette.accentMid)
                            .tabularNumerals()
                            .lineLimit(1)
                            // Two Inter Tight digits need 20, not the design's 16:
                            // at 16 the number wraps to a second line.
                            .frame(width: 20, alignment: .leading)
                        Text(chapter.title)
                            .typo(Typo.listTitle)
                            .foregroundStyle(Palette.accentDark)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(TodayText.sourceCount(chapter.sourceIds.count))
                            .typo(Typo.listTitle)
                            .foregroundStyle(Palette.accentMid)
                            .tabularNumerals()
                    }
                }
            }
        }
    }

    private var statusLine: String {
        episode.status == "failed"
            ? "La génération s’est arrêtée. Relancez-la avec le bouton Générer ci-dessous."
            : "Statut : \(TodayText.episodeStatusLabel(episode.status).lowercased()). L’audio apparaîtra ici une fois l’assemblage terminé."
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: 14) {
            // The mini bar and the full player read one shared EpisodePlayer,
            // so opening it here is what makes the bar appear over the tab bar.
            if detail.audioURL != nil {
                Button { EpisodePlayer.shared.open(detail) } label: {
                    HStack(spacing: 9) {
                        Text("▶").typo(Typo.buttonSmall)
                        Text("Listen").typo(Typo.buttonLarge)
                    }
                    .foregroundStyle(Palette.onDark)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 22)
                    .background(Palette.ink, in: Capsule())
                    .shadow(color: Palette.ink.opacity(0.22), radius: 12, y: 8)
                }
                .buttonStyle(.plain)
            }

            Button(action: onBackstage) {
                Text("How it was made")
                    .typo(Typo.link)
                    .foregroundStyle(Palette.accentDeep)
                    .underline()
                    .padding(.vertical, 10)
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 4)
    }

    // The design shows a verified-sentence count; the API publishes no grounding
    // report, so this line states only what the response proves.
    private var footnote: String {
        guard !detail.chapters.isEmpty else {
            return String(localized: "Script not written yet.")
        }
        let cited = Set(detail.chapters.flatMap(\.sourceIds))
        let resolved = Set(detail.chapters.flatMap { $0.sources.map(\.id) })
        let missing = cited.count - resolved.count
        var line = TodayText.plural(detail.chapters.count, "chapitre", "chapitres")
            + " · " + TodayText.plural(cited.count, "source citée", "sources citées")
        if missing > 0 {
            line += " · " + TodayText.plural(missing, "source introuvable", "sources introuvables")
        }
        return line
    }
}

// MARK: - Focus card

private struct TodayFocusCard: View {
    let source: SavedSource
    let isIncluded: Bool
    let onToggle: () -> Void

    var body: some View {
        PlainCard(cornerRadius: 16, padding: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(TodayText.sourceStatusLabel(source.status))
                        .textCase(.uppercase)
                        .typo(Typo.cardTag)
                        .foregroundStyle(TodayText.isFailure(source.status) ? Palette.danger : Palette.muted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Button(action: onToggle) {
                        Text(isIncluded ? "Inclus" : "Exclu")
                            .typo(Typo.chip)
                            .foregroundStyle(isIncluded ? Palette.onDark : Palette.muted)
                            .padding(.vertical, 4)
                            .padding(.horizontal, 10)
                            .background(isIncluded ? Palette.ink : Color.clear, in: Capsule())
                            .overlay(Capsule().strokeBorder(Palette.cardBorder, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }

                Text(TodayText.headline(for: source))
                    .typo(Typo.cardTitle)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                Text(TodayText.note(for: source))
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 172, alignment: .leading)
        }
    }
}

// MARK: - Generate card

private struct TodayGenerateCard: View {
    let readySourceCount: Int
    @Binding var targetMinutes: Int

    @State private var isGenerating = false
    @State private var outcome: Outcome?

    private enum Outcome {
        case queued
        // The server's French message, shown verbatim: it names the refusal
        // (briefing already in flight, cloud not wired up) better than a
        // client-side guess would.
        case failed(String)
    }

    var body: some View {
        PlainCard(cornerRadius: 18, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Next briefing")
                            .typo(Typo.rowTitleStrong)
                            .foregroundStyle(Palette.ink)
                        Text("\(TodayText.plural(readySourceCount, String(localized: "source ready"), String(localized: "sources ready"))) · target \(targetMinutes) min")
                            .typo(Typo.meta)
                            .foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    lengthPicker
                }

                Button { Task { await generate() } } label: {
                    Text(isGenerating ? "Envoi en cours…" : "Générer")
                        .typo(Typo.buttonLarge)
                        .foregroundStyle(Palette.onDark)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(
                            Palette.ink.opacity(isGenerating ? 0.55 : 1),
                            in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
                .disabled(isGenerating)

                switch outcome {
                case .queued:
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Episode in the works")
                            .typo(Typo.rowTitleStrong)
                            .foregroundStyle(Palette.ink)
                        Text("Give it about ten minutes: the briefing lands in the feed and at the top of this screen as soon as it is ready.")
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                case let .failed(message):
                    Text(message)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                case nil:
                    EmptyView()
                }
            }
        }
    }

    @MainActor
    private func generate() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            _ = try await API.shared.generateEpisode(targetMin: targetMinutes)
            outcome = .queued
            Feedback.launched()
        } catch APIError.http(_, let message) where !message.isEmpty {
            // 409 and 503 arrive here: the server already worded the refusal.
            outcome = .failed(message)
            Feedback.refused()
        } catch {
            outcome = .failed(error.localizedDescription)
            Feedback.refused()
        }
    }

    private var lengthPicker: some View {
        HStack(spacing: 0) {
            ForEach([5, 8, 10], id: \.self) { minutes in
                Button {
                    if minutes != targetMinutes { Feedback.select() }
                    targetMinutes = minutes
                } label: {
                    Text("\(minutes)′")
                        .typo(Typo.buttonSmall)
                        .foregroundStyle(minutes == targetMinutes ? Palette.onDark : Palette.body)
                        .tabularNumerals()
                        .padding(.vertical, 7)
                        .padding(.horizontal, 9)
                        .background(minutes == targetMinutes ? Palette.ink : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Palette.cardBorder, lineWidth: 1))
    }
}

// MARK: - Past episodes

private struct TodayPastRow: View {
    let episode: EpisodeSummary

    var body: some View {
        HStack(spacing: 12) {
            TodayLogo(size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(TodayText.title(episode.title, createdAt: episode.createdAt))
                    .typo(Typo.rowTitleStrong)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
                Text(meta)
                    .typo(Typo.meta)
                    .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if episode.status == "ready", let seconds = episode.actualSec {
                Text(TodayText.clock(seconds))
                    .typo(Typo.meta)
                    .foregroundStyle(Palette.muted)
                    .tabularNumerals()
            } else {
                StatusChip(
                    label: TodayText.episodeStatusLabel(episode.status),
                    kind: TodayText.episodeChipKind(episode.status)
                )
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 1) }
    }

    private var meta: String {
        let date = TodayText.dayMonth(episode.createdAt)
        guard !episode.chapters.isEmpty else { return date }
        return date + " · " + TodayText.plural(episode.chapters.count, "chapitre", "chapitres")
    }
}

// MARK: - Backstage

private struct TodayBackstageSheet: View {
    let detail: EpisodeDetail

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Overline(text: String(localized: "Comment c’est fabriqué"), color: Palette.accentDeep)
                    Spacer(minLength: 8)
                    Button("Close") { dismiss() }
                        .typo(Typo.navButton)
                        .foregroundStyle(Palette.accentDeep)
                }
                .padding(.bottom, 12)

                Text(TodayText.title(detail.title, createdAt: detail.createdAt))
                    .typo(Typo.playerTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 16)

                EpisodeBackstage(detail: detail)
            }
            .padding(20)
        }
        .background(ScreenBackground())
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Logo

private struct TodayLogo: View {
    var size: CGFloat
    var radius: CGFloat = 10

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return Group {
            if let image = UIImage(named: "logo") {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Palette.accent.opacity(0.25)
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Palette.cardBorder, lineWidth: 1))
    }
}

// MARK: - Copy and formatting

private enum TodayText {
    private static let french = AppLocale.current

    private static let dayMonthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = french
        formatter.dateFormat = "d MMMM"
        return formatter
    }()

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = french
        formatter.dateFormat = "EEE d MMMM"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = french
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func dayMonth(_ date: Date) -> String { dayMonthFormatter.string(from: date) }

    static func weekdayDayMonth(_ date: Date) -> String { weekdayFormatter.string(from: date) }

    /// Time of day for something captured today, its date otherwise.
    static func stamp(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? timeFormatter.string(from: date) : dayMonth(date)
    }

    static func clock(_ seconds: Int) -> String {
        let total = max(0, seconds)
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    static func plural(_ count: Int, _ singular: String, _ plural: String) -> String {
        "\(count) " + (count <= 1 ? singular : plural)
    }

    static func sourceCount(_ count: Int) -> String {
        count == 0 ? "" : plural(count, "source", "sources")
    }

    static func title(_ title: String?, createdAt: Date) -> String {
        if let title, !title.isEmpty { return title }
        return String(localized: "Briefing of ") + dayMonth(createdAt)
    }

    static func newTodayLabel(_ count: Int) -> String {
        switch count {
        case 0: return String(localized: "nothing new today")
        case 1: return String(localized: "1 new today")
        default: return String(localized: "\(count) new today")
        }
    }

    static func headline(for source: SavedSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let host = source.link?.host { return host }
        return String(localized: "Untitled")
    }

    /// The note under a focus card: the failure reason when there is one, since a
    /// source that cannot air has to say why on screen.
    static func note(for source: SavedSource) -> String {
        if let error = source.error, !error.isEmpty { return error }
        var parts: [String] = []
        if let publisher = source.publisher, !publisher.isEmpty { parts.append(publisher) }
        parts.append(source.inStory ? "rattaché à un sujet" : "pas encore rattaché")
        parts.append(stamp(source.capturedAt))
        return parts.joined(separator: " · ")
    }

    static func sourceTitle(_ source: ChapterSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        if let host = source.link?.host { return host }
        return String(localized: "Untitled")
    }

    static func sourceMeta(_ source: ChapterSource) -> String {
        var parts: [String] = []
        if let lang = source.lang, !lang.isEmpty { parts.append(lang.uppercased()) }
        if let quality = source.extractionQuality {
            parts.append("qualité " + String(format: "%.2f", quality).replacingOccurrences(of: ".", with: ","))
        }
        return parts.isEmpty ? "Aucune métadonnée d’extraction" : parts.joined(separator: " · ")
    }

    // src/core/types.ts SourceStatus. An unknown value is printed raw rather than
    // hidden: a status this app has never heard of is still information.
    static func sourceStatusLabel(_ status: String) -> String {
        switch status {
        case "received": return String(localized: "Received")
        case "extracting": return String(localized: "Extracting")
        case "analyzed": return String(localized: "Analysed")
        case "ready": return String(localized: "Ready")
        case "extraction_failed": return String(localized: "Failed")
        case "low_quality": return String(localized: "Low quality")
        case "unsupported": return String(localized: "Unsupported")
        case "duplicate": return String(localized: "Duplicate")
        default: return status
        }
    }

    /// Red is for a source that broke, not for one that simply repeats another.
    static func isFailure(_ status: String) -> Bool {
        ["extraction_failed", "low_quality", "unsupported"].contains(status)
    }

    /// Drives the default side of the Inclus/Exclu pill: a failed or duplicated
    /// source will not air whatever the pill says.
    static func canAir(_ status: String) -> Bool {
        !isFailure(status) && status != "duplicate"
    }

    // Episode statuses written by src/jobs/generateEpisode.ts and publishEpisode.ts.
    static func episodeStatusLabel(_ status: String) -> String {
        switch status {
        case "queued": return String(localized: "Queued")
        case "selecting": return String(localized: "Selecting")
        case "outlining": return String(localized: "Outline")
        case "writing": return String(localized: "Writing")
        case "grounding": return String(localized: "Checking")
        case "editing": return String(localized: "Editing")
        case "tts": return String(localized: "Narration")
        case "assembling": return String(localized: "Assembling")
        case "ready": return String(localized: "Ready")
        case "failed": return String(localized: "Failed")
        default: return status
        }
    }

    static func episodeChipKind(_ status: String) -> StatusChip.Kind {
        switch status {
        case "ready": return .success
        case "failed": return .danger
        default: return .neutral
        }
    }
}

// MARK: - Previews

#Preview("Today") {
    TodayView()
}
