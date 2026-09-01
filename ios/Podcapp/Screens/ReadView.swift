import SwiftUI
import UIKit

// The Read tab, <sc-if value="{{ tabRead }}"> in ios/design/layout.html: two
// states in one file. The list of briefings, and one briefing as an article.

struct ReadView: View {
    /// Wired to the player by the integrator. The API carries no per chapter
    /// timecode (see ScriptSchema in src/core/types.ts), so the chapter index
    /// travels instead of a position: the player is the single place that knows
    /// how to turn a chapter into a seek.
    var onListen: (EpisodeDetail, Int) -> Void = { _, _ in }

    @State private var episodes: Load<[EpisodeSummary]> = .loading
    @State private var opened: EpisodeSummary?

    var body: some View {
        if let opened {
            ArticleScreen(
                episode: opened,
                onBack: { self.opened = nil },
                onListen: onListen
            )
        } else {
            list
        }
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Read")
                    .typo(Typo.screenTitle)
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 6)
                Text("Every briefing, as an article.")
                    .typo(Typo.link)
                    .foregroundStyle(Palette.muted)
                    .padding(.top, 2)
                    .padding(.bottom, 14)

                switch episodes {
                case .loading:
                    StatusPanel(title: "Loading your briefings…", spinning: true)
                case let .failed(reason):
                    StatusPanel(
                        title: "Could not load your briefings.",
                        detail: reason,
                        retry: { Task { await loadEpisodes() } }
                    )
                case let .loaded(rows) where rows.isEmpty:
                    StatusPanel(
                        title: "No briefing yet.",
                        detail: "Save a few sources, then generate a briefing from the Today tab."
                    )
                case let .loaded(rows):
                    ForEach(rows) { row($0) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        // Coming back from an article must not refetch what is already loaded.
        .task { if case .loading = episodes { await loadEpisodes() } }
    }

    private func row(_ episode: EpisodeSummary) -> some View {
        let readable = !episode.chapters.isEmpty
        return Button {
            opened = episode
        } label: {
            HStack(spacing: 12) {
                Artwork()
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.title(episode.title, on: episode.createdAt))
                        .typo(Typo.rowTitleStrong)
                        .foregroundStyle(Palette.ink)
                    Text(rowMeta(episode))
                        .typo(Typo.meta)
                        .foregroundStyle(Palette.muted)
                        .tabularNumerals()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                badge(for: episode)
            }
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Palette.hairline).frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(!readable)
        .opacity(readable ? 1 : 0.55)
    }

    /// The badge says why a row cannot be opened, it never just greys out.
    @ViewBuilder
    private func badge(for episode: EpisodeSummary) -> some View {
        if !episode.chapters.isEmpty {
            ReadBadge(label: "Read")
        } else if episode.status == "failed" {
            StatusChip(label: "Failed", kind: .danger)
        } else if episode.status == "ready" {
            StatusChip(label: "Audio only", kind: .aired)
        } else {
            StatusChip(label: "In progress", kind: .neutral)
        }
    }

    private func rowMeta(_ episode: EpisodeSummary) -> String {
        var parts = [Format.day(episode.createdAt)]
        if let seconds = episode.actualSec { parts.append(Format.clock(seconds)) }
        let count = episode.chapters.count
        if count > 0 { parts.append(count > 1 ? "\(count) chapitres" : "1 chapitre") }
        return parts.joined(separator: " · ")
    }

    private func loadEpisodes() async {
        episodes = .loading
        do {
            episodes = .loaded(try await API.shared.episodes())
        } catch {
            episodes = .failed(error.localizedDescription)
        }
    }
}

// MARK: - Article

private struct ArticleScreen: View {
    let episode: EpisodeSummary
    var onBack: () -> Void
    var onListen: (EpisodeDetail, Int) -> Void

    @State private var detail: Load<EpisodeDetail> = .loading

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Button(action: onBack) {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("All episodes")
                            .typo(Typo.navButton)
                    }
                    .foregroundStyle(Palette.accentDeep)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)

                switch detail {
                case .loading:
                    StatusPanel(title: "Loading the briefing…", spinning: true)
                case let .failed(reason):
                    StatusPanel(
                        title: "Could not open this briefing.",
                        detail: reason,
                        retry: { Task { await load() } }
                    )
                case let .loaded(full):
                    article(full)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .task { await load() }
    }

    @ViewBuilder
    private func article(_ full: EpisodeDetail) -> some View {
        Overline(text: Format.overline(full.createdAt), color: Palette.accentMuted)
            .padding(.top, 8)
        Text(Format.title(full.title, on: full.createdAt))
            .typo(Typo.articleTitle)
            .foregroundStyle(Palette.ink)
            .padding(.top, 8)
        let meta = articleMeta(full)
        if !meta.isEmpty {
            Text(meta)
                .typo(Typo.meta)
                .foregroundStyle(Palette.muted)
                .tabularNumerals()
                .padding(.top, 6)
        }

        if full.chapters.isEmpty {
            StatusPanel(
                title: "This briefing has no text yet.",
                detail: missingScript(full.status)
            )
        } else {
            ForEach(full.chapters.indices, id: \.self) { index in
                chapter(full, index: index)
            }
        }
    }

    private func chapter(_ full: EpisodeDetail, index: Int) -> some View {
        let chapter = full.chapters[index]
        let paragraphs = Format.paragraphs(chapter.text)
        let sourceLine = Format.sourceLine(chapter.sources)
        // Without audio there is nothing to seek into, so the affordance is
        // absent rather than dead.
        let listenable = full.audioURL != nil

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(Format.chapterNumber(index))
                    .typo(Typo.buttonSmall.tabular)
                    .foregroundStyle(Palette.accentMid)
                Text(chapter.title)
                    .typo(Typo.chapterTitle)
                    .foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(paragraphs.indices, id: \.self) { paragraph in
                Text(paragraphs[paragraph])
                    .typo(Typo.paragraph)
                    .foregroundStyle(Palette.prose)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if listenable || sourceLine != nil {
                HStack(spacing: 12) {
                    if listenable {
                        Button { onListen(full, index) } label: { listenLabel }
                            .buttonStyle(.plain)
                    }
                    if let sourceLine {
                        Text(sourceLine)
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.accentDeep)
                    }
                }
            }
        }
        .padding(.top, 22)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var listenLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "play.fill")
                .font(.system(size: 9))
            Text("Listen here")
                .typo(Typo.pillButton)
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, 13)
        .padding(.vertical, 7)
        .background(Palette.ink.opacity(0.04), in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.ink.opacity(0.14), lineWidth: 1))
    }

    private func articleMeta(_ full: EpisodeDetail) -> String {
        var parts: [String] = []
        if let seconds = full.actualSec { parts.append(Format.clock(seconds)) }
        let sources = Set(full.chapters.flatMap(\.sources).map(\.id)).count
        if sources > 0 { parts.append(sources > 1 ? "\(sources) sources" : "1 source") }
        // Every episode that ships has been through the grounding pass, so the
        // claim is only made once the episode is actually out.
        if full.status == "ready" { parts.append("✓ vérifié") }
        return parts.joined(separator: " · ")
    }

    private func missingScript(_ status: String) -> String {
        switch status {
        case "failed": return String(localized: "Generation failed before the script was written.")
        case "ready": return String(localized: "The episode is published, but its script is empty.")
        default: return String(localized: "The script is still being written. Come back in a few minutes.")
        }
    }

    private func load() async {
        // A ready episode's script never changes, so reopening an article the
        // reader just left must not refetch and re-render a loading panel.
        if let cached = await ArticleCache.shared.detail(for: episode.id) {
            detail = .loaded(cached)
            return
        }
        detail = .loading
        do {
            let full = try await API.shared.episode(id: episode.id)
            if full.status == "ready" { await ArticleCache.shared.store(full) }
            detail = .loaded(full)
        } catch {
            detail = .failed(error.localizedDescription)
        }
    }
}

/// Session-lifetime cache of READY episode details: their script, grounding
/// and sources are immutable once published. Non-ready episodes are never
/// stored, so a briefing in progress keeps refreshing.
@MainActor
private final class ArticleCache {
    static let shared = ArticleCache()
    private var byId: [String: EpisodeDetail] = [:]

    func detail(for id: String) -> EpisodeDetail? { byId[id] }
    func store(_ detail: EpisodeDetail) { byId[detail.id] = detail }
}

// MARK: - Pieces

private enum Load<Value> {
    case loading
    case failed(String)
    case loaded(Value)
}

/// Loading, failure and emptiness share one block: a line saying what happened,
/// the server's own reason when there is one, and a retry when retrying helps.
private struct StatusPanel: View {
    let title: String
    var detail: String?
    var spinning: Bool = false
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if spinning {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(title)
                        .typo(Typo.rowTitle)
                        .foregroundStyle(Palette.body)
                }
            } else {
                Text(title)
                    .typo(Typo.rowTitleStrong)
                    .foregroundStyle(Palette.ink)
            }
            if let detail {
                Text(detail)
                    .typo(Typo.detail)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let retry {
                Button("Try again", action: retry)
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.accentDeep)
                    .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 28)
    }
}

/// The dark pill on a readable episode. StatusChip covers the muted pairs, this
/// is the one white on ink badge the markup uses.
private struct ReadBadge: View {
    let label: String

    var body: some View {
        Text(label)
            .textCase(.uppercase)
            .typo(Typo.chip)
            .foregroundStyle(Palette.onDark)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Palette.ink, in: Capsule())
    }
}

/// The episode thumbnail. A missing asset leaves a tinted tile, never a hole.
private struct Artwork: View {
    private let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)

    var body: some View {
        Group {
            if let logo = UIImage(named: "logo") {
                Image(uiImage: logo).resizable().scaledToFill()
            } else {
                Palette.accent.opacity(0.18)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Palette.ink.opacity(0.1), lineWidth: 1))
    }
}

private enum Format {
    static func clock(_ seconds: Int) -> String {
        let total = max(0, seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    static func day(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// "BRIEFING DU VENDREDI · 28 AOÛT 2026", uppercased by Overline.
    static func overline(_ date: Date) -> String {
        String(localized: "Briefing of \(weekdayFormatter.string(from: date)) · \(fullDateFormatter.string(from: date))")
    }

    /// An episode still being written has no title yet, and its date is the only
    /// honest thing left to name it by.
    static func title(_ title: String?, on date: Date) -> String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? String(localized: "Briefing of \(day(date))") : trimmed
    }

    static func chapterNumber(_ index: Int) -> String {
        String(format: "%02d", index)
    }

    /// The script is narration: its paragraphs arrive as newline separated
    /// blocks, and a chapter with none is still one paragraph.
    static func paragraphs(_ text: String) -> [String] {
        text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    static func sourceLine(_ sources: [ChapterSource]) -> String? {
        let names = sources.compactMap { source -> String? in
            let name = (source.publisher ?? source.title)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return name?.isEmpty == false ? name : nil
        }
        guard let first = names.first else { return nil }
        return names.count > 1
            ? String(localized: "Source: \(first) +\(names.count - 1)")
            : String(localized: "Source: \(first)")
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = AppLocale.current
        formatter.dateFormat = format
        return formatter
    }

    private static let dayFormatter = formatter("d MMMM")
    private static let fullDateFormatter = formatter("d MMMM yyyy")
    private static let weekdayFormatter = formatter("EEEE")
}

// MARK: - Previews

#Preview("Lire") {
    ReadView()
        .background(ScreenBackground())
}
