import SwiftUI
import UIKit

// The Today tab of the v3 prototype (/tmp/podcapp-shots/v3.html): the latest
// briefing, what is queued for the next one, and the episodes before it.
//
// One write: Generate posts to /episodes, which queues the generation in the
// cloud. The server owns every refusal (a briefing already in flight, cloud
// not wired up) and words it in French, so this screen shows its message
// verbatim instead of inventing its own diagnosis.

struct TodayView: View {
    @State private var phase: Phase = .loading
    @State private var backstage: EpisodeDetail?
    @State private var targetMinutes = 5
    /// The prototype's strip is one flex row, so every past card is as tall as
    /// the hero. SwiftUI sizes them independently, so the hero measures itself
    /// and the others follow.
    @State private var heroHeight: CGFloat = 250

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
            // The prototype's 64pt of head room is mostly the status bar, which
            // the safe area already pays for; only the remainder is ours.
            .padding(.top, 4)
            .padding(.bottom, 32)
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
        TodayCard(cornerRadius: Radius.panel, padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                Overline(text: String(localized: "Could not load"), color: Palette.danger)
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
                        .dropShadow(Palette.darkButtonShadow)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }

    // MARK: - Hero strip

    /// The latest briefing first, the earlier ones behind it as narrower cards,
    /// one page per swipe. The design's answer to a list of past episodes that
    /// pushed Generate below the fold.
    @ViewBuilder
    private func heroStrip(_ data: TodayData) -> some View {
        if data.featured == nil && data.past.isEmpty {
            noEpisodeCard.padding(.horizontal, 20).padding(.top, 6)
        } else {
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: TodayMetric.stripGap) {
                    if let featured = data.featured {
                        TodayHeroCard(
                            episode: featured.episode,
                            detail: featured.detail,
                            onBackstage: { backstage = featured.detail }
                        )
                        // The prototype's hero is 338 wide on a 402 screen, so
                        // the next card peeks in by 44. `width` here is what
                        // contentMargins leaves of the screen (362), not the
                        // screen itself, hence 24 rather than 64.
                        .containerRelativeFrame(.horizontal) { width, _ in width - 24 }
                        .background {
                            GeometryReader { geo in
                                Color.clear.preference(key: TodayHeroHeight.self, value: geo.size.height)
                            }
                        }
                    }
                    ForEach(data.past) { episode in
                        TodayPastCard(episode: episode, minHeight: heroHeight)
                            // 274: the prototype's 236pt card plus its 18pt
                            // padding and 1pt edge on both sides.
                            .containerRelativeFrame(.horizontal) { width, _ in width - 88 }
                    }
                }
                .scrollTargetLayout()
                // A horizontal ScrollView clips its content, and the cards cast a
                // 20pt shadow 16pt down; without this it lands on a hard edge.
                // The prototype pays for that room the same way, with padding it
                // then takes back as a negative margin -- and keeps 6pt of it,
                // which is the whole gap between the header and the strip.
                .padding(.top, 32)
                .padding(.bottom, 26)
            }
            .contentMargins(.horizontal, 20, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .padding(.top, -26)
            .padding(.bottom, -26)
            .onPreferenceChange(TodayHeroHeight.self) { if $0 > 0 { heroHeight = $0 } }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ data: TodayData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            heroStrip(data)

            TodayGenerateCard(
                readySourceCount: data.available ?? data.readyCount,
                minimum: data.minimum ?? 4,
                targetMinutes: $targetMinutes
            )
            .padding(.horizontal, 20)
            // What the prototype's strip leaves under the cards once its 66pt
            // of shadow room is pulled back by a -36 margin.
            .padding(.top, 30)

            focusSection(data)
        }
    }

    private var noEpisodeCard: some View {
        TodayCard(padding: EdgeInsets(top: 20, leading: 20, bottom: 18, trailing: 20)) {
            VStack(alignment: .leading, spacing: 12) {
                Overline(text: String(localized: "No briefing"), color: Palette.accentDeep)
                Text("Nothing to listen to yet.")
                    .typo(Typo.heroTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Share a few links from Safari, then hit Generate below: the first episode shows up here as soon as it is ready.")
                    .typo(TodayType.note)
                    .foregroundStyle(Palette.accentMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
        .padding(.top, 18)
        .padding(.bottom, 10)

        if data.focus.isEmpty {
            TodayCard(cornerRadius: Radius.group, padding: 14) {
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
                HStack(alignment: .top, spacing: TodayMetric.storyGap) {
                    ForEach(data.focus) { source in
                        TodayFocusCard(source: source)
                    }
                }
                .padding(.horizontal, 20)
                // Shadow room paid for and taken back, as in the hero strip;
                // the 6pt left over is the gap under the section head.
                .padding(.top, 32)
                .padding(.bottom, 26)
            }
            .padding(.top, -26)
            .padding(.bottom, -26)
        }
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
            // The batch carries the server's own count of what an episode can be
            // built from: the card shows that number, never a client-side guess.
            let batch: API.SourceBatch
            do {
                batch = try await sourcesCall
            } catch {
                detailTask.cancel()
                throw error
            }
            let sources = batch.sources
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
                    available: batch.available,
                    minimum: batch.minimum,
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
        // The server's count of sources behind open stories, and its minimum.
        let available: Int?
        let minimum: Int?
        let newTodayCount: Int
    }
}

// MARK: - Metrics and local type roles

private enum TodayMetric {
    /// Between the cards of the hero strip.
    static let stripGap: CGFloat = 12
    /// Between the story cards under Tomorrow.
    static let storyGap: CGFloat = 10
    /// The N-of-4 ring: a 40-unit viewBox drawn at 46pt, so its 16-unit radius
    /// lands at 36.8pt across and its 3.6-unit stroke at 4.14pt.
    static let ringBox: CGFloat = 46
    static let ringDiameter: CGFloat = 36.8
    static let ringStroke: CGFloat = 4.14
    /// Story cards render 230x125 in the prototype. Only the 14pt padding comes
    /// off here: `TodayCard` strokes its edge inside the card, so the border is
    /// already inside the 230 rather than added to it.
    static let storyWidth: CGFloat = 202
    static let storyMinHeight: CGFloat = 95
}

/// Two roles the prototype uses on this screen that no shared token names yet.
/// Promote them to `Typo` if another screen turns out to need them.
private enum TodayType {
    /// Chapter rows in the hero card: 13px/400. `Typo.field` has the same
    /// metrics but belongs to the search box.
    static let chapterLine = TypoStyle(size: 13, weight: .regular)
    /// Card and rule notes: 11.5px/400 at line-height 1.4, between the shared
    /// `metaSmall` (font default) and `note` (1.5).
    static let note = TypoStyle(size: 11.5, weight: .regular, lineHeight: 1.4)
}

/// The hero's measured height, so the past cards can match it. Zero means "not
/// measured": the lazy strip drops the hero once it scrolls off, and the last
/// known height has to survive that rather than snap back to a default.
private struct TodayHeroHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

// MARK: - Card surface

/// Every surface on this screen: a translucent fill, a 1pt edge, the ambient
/// drop shadow, and the prototype's `inset 0 1px 0 rgba(255,255,255,.92)`.
/// SwiftUI has no inset shadow, so the border fades from that highlight down to
/// the flat edge colour — the same trick the tab bar uses.
private struct TodayCard<Content: View>: View {
    var cornerRadius: CGFloat = Radius.card
    var padding = EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)
    var fill: Color = Palette.cardFill
    var edge: Color = Palette.cardBorder
    /// Only the generation panel blurs what is behind it; the cards do not.
    var blurred = false
    var content: Content

    init(
        cornerRadius: CGFloat = Radius.card,
        padding: EdgeInsets = EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14),
        fill: Color = Palette.cardFill,
        edge: Color = Palette.cardBorder,
        blurred: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.padding = padding
        self.fill = fill
        self.edge = edge
        self.blurred = blurred
        self.content = content()
    }

    /// The uniform-padding spelling the call sites mostly want.
    init(
        cornerRadius: CGFloat = Radius.card,
        padding: CGFloat,
        fill: Color = Palette.cardFill,
        edge: Color = Palette.cardBorder,
        blurred: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            cornerRadius: cornerRadius,
            padding: EdgeInsets(top: padding, leading: padding, bottom: padding, trailing: padding),
            fill: fill,
            edge: edge,
            blurred: blurred,
            content: content
        )
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: .continuous) }

    var body: some View {
        content
            .padding(padding)
            .background {
                shape
                    .fill(fill)
                    .background { if blurred { shape.fill(.ultraThinMaterial) } }
                    .overlay {
                        shape.strokeBorder(Palette.glassEdge(edge), lineWidth: 1)
                    }
                    .dropShadow(Palette.cardShadow)
            }
    }
}

// MARK: - Hero

private struct TodayHeroCard: View {
    let episode: EpisodeSummary
    let detail: EpisodeDetail
    let onBackstage: () -> Void

    var body: some View {
        TodayCard(padding: EdgeInsets(top: 20, leading: 20, bottom: 18, trailing: 20)) {
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
                        .typo(TodayType.note)
                        .foregroundStyle(Palette.accentMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                actions

                Text(footnote)
                    .typo(TodayType.note)
                    .foregroundStyle(Palette.accentMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 11)
                    .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
                            .typo(TodayType.chapterLine)
                            .foregroundStyle(Palette.accentDark)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(TodayText.sourceCount(chapter.sourceIds.count))
                            .typo(TodayType.chapterLine)
                            .foregroundStyle(Palette.accentMid)
                            .tabularNumerals()
                    }
                }
            }
        }
    }

    private var statusLine: String {
        episode.status == "failed"
            ? String(localized: "Generation stopped. Start it again with the Generate button below.")
            : String(localized: "Status: \(TodayText.episodeStatusLabel(episode.status).lowercased()). The audio appears here once assembly is done.")
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
                    .dropShadow(Palette.darkButtonShadow)
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
        var line = TodayText.plural(detail.chapters.count, String(localized: "chapter"), String(localized: "chapters"))
            + " · " + TodayText.plural(cited.count, String(localized: "source cited"), String(localized: "sources cited"))
        if missing > 0 {
            line += " · " + TodayText.plural(missing, "source introuvable", "sources introuvables")
        }
        return line
    }
}

// MARK: - Focus card

private struct TodayFocusCard: View {
    let source: SavedSource

    var body: some View {
        TodayCard(cornerRadius: Radius.group, padding: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text(TodayText.sourceStatusLabel(source.status))
                    .textCase(.uppercase)
                    .typo(Typo.cardTag)
                    .foregroundStyle(TodayText.isFailure(source.status) ? Palette.danger : Palette.muted)
                    .lineLimit(1)

                Text(TodayText.headline(for: source))
                    .typo(Typo.cardTitle)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                Text(TodayText.note(for: source))
                    .typo(TodayType.note)
                    .foregroundStyle(Palette.muted)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Fixed width, floor on the height: SwiftUI has no width+minHeight
            // overload, so the width is pinned through min/max instead.
            .frame(
                minWidth: TodayMetric.storyWidth,
                maxWidth: TodayMetric.storyWidth,
                minHeight: TodayMetric.storyMinHeight,
                alignment: .topLeading
            )
        }
    }
}

// MARK: - Generate card

private struct TodayGenerateCard: View {
    let readySourceCount: Int
    let minimum: Int
    @Binding var targetMinutes: Int

    private var rule: MinimumSourcesRule { MinimumSourcesRule(count: readySourceCount, minimum: minimum) }
    @State private var generation: GenerationTarget?

    @State private var isGenerating = false
    @State private var outcome: Outcome?

    /// The episode length the server accepts. The cap is 5 minutes, so the
    /// prototype's 10/15/20 becomes the three lengths that actually exist.
    private static let lengths = [3, 4, 5]

    private enum Outcome {
        case queued
        // The server's French message, shown verbatim: it names the refusal
        // (briefing already in flight, cloud not wired up) better than a
        // client-side guess would.
        case failed(String)
    }

    var body: some View {
        card.sheet(item: $generation) { target in
            GenerationSheet(episodeId: target.id)
        }
    }

    private var card: some View {
        TodayCard(cornerRadius: Radius.panel, padding: 16, fill: Palette.panelFill, edge: Palette.panelBorder, blurred: true) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Next briefing")
                            .typo(Typo.rowTitleStrong)
                            .foregroundStyle(Palette.ink)
                        Text("\(readySourceCount) ready · ~\(targetMinutes) min")
                            .typo(Typo.meta)
                            .foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    lengthPicker
                }

                // The four-link rule, drawn rather than explained: the ring fills
                // with the server's own count and turns green at the minimum.
                HStack(spacing: 13) {
                    ruleRing
                    VStack(alignment: .leading, spacing: 1) {
                        Text(rule.title)
                            .typo(Typo.buttonMedium)
                            .foregroundStyle(Palette.ink)
                        Text(ruleSub)
                            .typo(TodayType.note)
                            .foregroundStyle(Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.top, 2)
                .padding(.bottom, 4)

                Button { Task { await generate() } } label: {
                    Text(isGenerating ? String(localized: "Sending…") : String(localized: "Generate now"))
                        .typo(Typo.buttonLarge)
                        .foregroundStyle(Palette.onDark)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Palette.accentGradient, in: Capsule())
                        .overlay {
                            // The prototype's `inset 0 1px 0 rgba(255,255,255,.3)`
                            // over the gradient, drawn as a fading edge.
                            Capsule().strokeBorder(Palette.accentEdge, lineWidth: 1)
                        }
                        .dropShadow(Palette.ctaShadow)
                }
                .buttonStyle(.plain)
                // The design dims the whole button rather than swapping its
                // fill, so a refused tap still reads as the same one. That is
                // what `disabled` already does, and to about the prototype's
                // `opacity:.5`; dimming the label as well only halved it twice.
                .disabled(isGenerating || !rule.met)

                switch outcome {
                case .queued:
                    // The sheet carries the progress; this line remains for
                    // when it has been dismissed and the run is still going.
                    Text("Episode in the works · the feed and this screen update as soon as it is ready.")
                        .typo(TodayType.note)
                        .foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                case let .failed(message):
                    Text(message)
                        .typo(TodayType.note)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                case nil:
                    EmptyView()
                }
            }
        }
    }

    private var ruleSub: String {
        rule.met
            ? String(localized: "Ready to generate · target \(targetMinutes) min.")
            : rule.explanation
    }

    private var ruleRing: some View {
        let fraction = min(1, Double(readySourceCount) / Double(max(1, minimum)))
        let tint = rule.met ? Palette.success : Palette.accent
        return ZStack {
            Circle()
                .stroke(Palette.tileBorder, lineWidth: TodayMetric.ringStroke)
                .frame(width: TodayMetric.ringDiameter, height: TodayMetric.ringDiameter)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(tint, style: StrokeStyle(lineWidth: TodayMetric.ringStroke, lineCap: .round))
                .frame(width: TodayMetric.ringDiameter, height: TodayMetric.ringDiameter)
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.5), value: fraction)
            Text("\(min(readySourceCount, minimum))/\(minimum)")
                .typo(Typo.buttonSmall)
                .foregroundStyle(Palette.ink)
                .tabularNumerals()
        }
        .frame(width: TodayMetric.ringBox, height: TodayMetric.ringBox)
        .accessibilityLabel(rule.title)
    }

    @MainActor
    private func generate() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            let id = try await API.shared.generateEpisode(targetMin: targetMinutes)
            outcome = .queued
            generation = GenerationTarget(id: id)
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
            ForEach(Self.lengths, id: \.self) { minutes in
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
        .overlay(Capsule().strokeBorder(Palette.controlBorder, lineWidth: 1))
    }
}

// MARK: - Past episodes

/// An earlier briefing in the hero strip: title, date, and one tap to play.
private struct TodayPastCard: View {
    let episode: EpisodeSummary
    /// The hero's height, so the strip reads as one row rather than a staircase.
    let minHeight: CGFloat

    var body: some View {
        TodayCard(padding: 18) {
            VStack(alignment: .leading, spacing: 9) {
                TodayLogo(size: 34, radius: Radius.logoSmall, ring: Palette.divider)
                Text(TodayText.title(episode.title, createdAt: episode.createdAt))
                    .typo(Typo.episodeTitle)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(meta)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted)
                Spacer(minLength: 12)
                if episode.status == "ready", let seconds = episode.actualSec {
                    Button { EpisodePlayer.shared.open(episodeId: episode.id) } label: {
                        HStack(spacing: 7) {
                            Text("▶").typo(Typo.pillButton)
                            Text(TodayText.clock(seconds)).typo(Typo.pillButton).tabularNumerals()
                        }
                        .foregroundStyle(Palette.onDark)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 14)
                        .background(Palette.ink, in: Capsule())
                    }
                    .buttonStyle(.plain)
                } else {
                    StatusChip(
                        label: TodayText.episodeStatusLabel(episode.status),
                        kind: TodayText.episodeChipKind(episode.status)
                    )
                }
            }
            .frame(maxWidth: .infinity, minHeight: minHeight - 36, alignment: .topLeading)
        }
    }

    private var meta: String {
        let date = TodayText.dayMonth(episode.createdAt)
        guard !episode.chapters.isEmpty else { return date }
        return date + " · " + TodayText.plural(episode.chapters.count, String(localized: "chapter"), String(localized: "chapters"))
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
                    Overline(text: String(localized: "How it was made"), color: Palette.accentDeep)
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
    var radius: CGFloat = Radius.logo
    /// The prototype rings the 32pt wordmark logo at .12 and the 34pt one on a
    /// past-episode card at .08.
    var ring: Color = Palette.filterBorder

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
        .overlay(shape.strokeBorder(ring, lineWidth: 1))
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
        parts.append(source.inStory ? String(localized: "attached to a story") : String(localized: "not attached yet"))
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
            parts.append(String(localized: "quality ") + String(format: "%.2f", locale: AppLocale.current, quality))
        }
        return parts.isEmpty ? String(localized: "No extraction metadata") : parts.joined(separator: " · ")
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
