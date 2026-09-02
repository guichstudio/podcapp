import SwiftUI

// The backstage of an episode: the plan, the verification, the pipeline and the
// bill. One view, rendered from the Today hero and from the player alike, so the
// two entry points can never drift apart.
struct EpisodeBackstage: View {
    let detail: EpisodeDetail

    /// The nine editorial steps of the pipeline, in the order it runs them.
    private static let stages: [(String, String)] = [
        (String(localized: "Queued"), String(localized: "Target set before writing")),
        (String(localized: "Selecting"), String(localized: "Ranked by importance × novelty")),
        (String(localized: "Outline"), String(localized: "150 s here, 90 s there: named cuts")),
        (String(localized: "Writing"), String(localized: "≈1,500 words, documentary register")),
        (String(localized: "Checking"), String(localized: "Every sentence against its source")),
        (String(localized: "Editing"), String(localized: "Blocklist: zero tics on air")),
        (String(localized: "Narration"), String(localized: "Documentary voice")),
        (String(localized: "Assembling"), String(localized: "Chapters joined, level set")),
        (String(localized: "Ready"), String(localized: "Kept + set aside, with reasons")),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Built, not read aloud.")
                .typo(Typo.detail)
                .foregroundStyle(Palette.body)

            budget(detail)
            stats(detail)
            pipeline(detail)
            runLine(detail)
        }
    }

    // The airtime the outline budgeted before a word was written, which is the
    // point of showing it: the plan is what makes the cuts explicable.
    private func budget(_ episode: EpisodeDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Overline(text: String(localized: "Airtime budget, set before writing"))
            if episode.budget.isEmpty {
                Text("The editorial plan for this episode was not kept.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            } else {
                let longest = max(episode.budget.map(\.airtimeSec).max() ?? 1, 1)
                ForEach(episode.budget) { line in
                    HStack(spacing: 10) {
                        Text(line.title)
                            .typo(Typo.detail)
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Palette.ink.opacity(0.1))
                                Capsule().fill(Palette.accent)
                                    .frame(width: geo.size.width * CGFloat(line.airtimeSec) / CGFloat(longest))
                            }
                        }
                        .frame(width: 96, height: 6)
                        Text("\(line.airtimeSec) s")
                            .typo(Typo.metaSmall)
                            .foregroundStyle(Palette.muted)
                            .tabularNumerals()
                            .frame(width: 44, alignment: .trailing)
                    }
                }
            }
            if let first = episode.discarded.first {
                PlayerFlag(
                    label: String(localized: "Set aside"),
                    text: {
                        let rest = episode.discarded.count - 1
                        if rest <= 0 { return first }
                        return rest == 1
                            ? String(localized: "\(first) (and 1 other topic set aside, with its reason)")
                            : String(localized: "\(first) (and \(rest) other topics set aside, each with its reason)")
                    }()
                )
            }
        }
    }

    // The promise, in three numbers: what was checked, what the evidence changed,
    // and what never reached the audio.
    private func stats(_ episode: EpisodeDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Overline(text: String(localized: "Verification pass"))
            if let v = episode.verification, v.checked > 0 {
                HStack(spacing: 8) {
                    PlayerStat(value: v.checked, label: String(localized: "sentences checked"))
                    Divider().frame(height: 40).overlay(Palette.cardBorder)
                    PlayerStat(value: v.corrected, label: String(localized: "rewritten to match the evidence"))
                    Divider().frame(height: 40).overlay(Palette.cardBorder)
                    PlayerStat(value: v.dropped, label: String(localized: "cut before air"))
                }
                .padding(13)
                .frame(maxWidth: .infinity)
                .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.09), lineWidth: 1)
                )
            } else {
                Text("No verification report for this episode.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
        }
    }

    private func runLine(_ episode: EpisodeDetail) -> some View {
        var parts: [String] = []
        if let sec = episode.actualSec { parts.append("\(sec / 60) min \(String(format: "%02d", sec % 60)) s") }
        return Text(parts.joined(separator: " · "))
            .typo(Typo.metaTiny)
            .foregroundStyle(Palette.muted2)
    }

    private func pipeline(_ episode: EpisodeDetail) -> some View {
        // Only a published episode has actually walked all nine stages; ticking
        // them on a queued one would be a claim the status contradicts.
        let done = episode.status == "ready"
        return VStack(alignment: .leading, spacing: 8) {
            Overline(text: String(localized: "Pipeline"))
            PlayerFlowLayout(spacing: 6) {
                ForEach(Self.stages, id: \.0) { stage in
                    Text((done ? "✓ " : "") + stage.0)
                        .typo(Typo.metaTiny)
                        .foregroundStyle(Palette.ink2)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Palette.neutralChipBg, in: Capsule())
                        .opacity(done ? 1 : 0.45)
                }
            }
            Text(footer(episode))
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .padding(.top, 4)
        }
    }

    private func footer(_ episode: EpisodeDetail) -> String {
        var parts = [String(localized: "Status: ") + EpisodePlayer.statusLabel(episode.status)]
        let n = episode.chapters.count
        parts.append(n == 1 ? String(localized: "1 chapter") : String(localized: "\(n) chapters"))
        return parts.joined(separator: " · ")
    }
}

// MARK: - Small pieces

