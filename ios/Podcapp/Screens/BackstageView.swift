import SwiftUI

// The backstage of an episode: the plan, the verification, the pipeline and the
// bill. One view, rendered from the Today hero and from the player alike, so the
// two entry points can never drift apart.
struct EpisodeBackstage: View {
    let detail: EpisodeDetail

    /// The nine editorial steps of the pipeline, in the order it runs them.
    private static let stages: [(String, String)] = [
        ("En file", "Cible fixée avant l’écriture"),
        ("Sélection", "Classé par importance × nouveauté"),
        ("Plan", "150 s ici, 90 s là : coupes nommées"),
        ("Écriture", "≈1 500 mots, registre documentaire"),
        ("Vérification", "Chaque phrase face à sa source"),
        ("Édition", "Blocklist : zéro tic à l’antenne"),
        ("Narration", "Voix documentaire française"),
        ("Assemblage", "Chapitres assemblés, niveau réglé"),
        ("Prêt", "Retenus + écartés, avec raisons"),
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
            Overline(text: "Budget d’antenne, fixé avant l’écriture")
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
                    label: "Set aside",
                    text: {
                        let rest = episode.discarded.count - 1
                        if rest <= 0 { return first }
                        // "1 autres sujets" is not French: the tail agrees.
                        return rest == 1
                            ? "\(first) (et 1 autre sujet écarté, avec sa raison)"
                            : "\(first) (et \(rest) autres sujets écartés, chacun avec sa raison)"
                    }()
                )
            }
        }
    }

    // The promise, in three numbers: what was checked, what the evidence changed,
    // and what never reached the audio.
    private func stats(_ episode: EpisodeDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Overline(text: "Passe de vérification")
            if let v = episode.verification, v.checked > 0 {
                HStack(spacing: 8) {
                    PlayerStat(value: v.checked, label: "sentences checked")
                    Divider().frame(height: 40).overlay(Palette.cardBorder)
                    PlayerStat(value: v.corrected, label: "rewritten to match the evidence")
                    Divider().frame(height: 40).overlay(Palette.cardBorder)
                    PlayerStat(value: v.dropped, label: "cut before air")
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
        if let usd = episode.usd { parts.append(String(format: "%.2f $", usd)) }
        return Text(parts.joined(separator: " · "))
            .typo(Typo.metaTiny)
            .foregroundStyle(Palette.muted2)
    }

    private func pipeline(_ episode: EpisodeDetail) -> some View {
        // Only a published episode has actually walked all nine stages; ticking
        // them on a queued one would be a claim the status contradicts.
        let done = episode.status == "ready"
        return VStack(alignment: .leading, spacing: 8) {
            Overline(text: "Pipeline")
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
        var parts = ["Statut : " + EpisodePlayer.frenchStatus(episode.status)]
        parts.append("\(episode.chapters.count) chapitre\(episode.chapters.count > 1 ? "s" : "")")
        return parts.joined(separator: " · ")
    }
}

// MARK: - Small pieces

