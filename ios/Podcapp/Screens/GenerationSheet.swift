import SwiftUI

struct GenerationTarget: Identifiable {
    let id: String
}

/// The nine editorial steps, followed live. The pipeline writes its status on
/// the episode row at every stage, so this only has to read it back: no
/// invented timer, no progress that runs ahead of the work.
struct GenerationSheet: View {
    let episodeId: String

    @Environment(\.dismiss) private var dismiss
    @State private var status = "queued"
    @State private var detail: EpisodeDetail?
    @State private var failure: String?

    // Order and wording from the design; the statuses are the ones
    // src/jobs/generateEpisode.ts and publishEpisode.ts actually write.
    private static let stages: [(status: String, label: String, caption: String)] = [
        ("queued", String(localized: "Queued"), String(localized: "Target set before writing")),
        ("selecting", String(localized: "Selecting"), String(localized: "Ranked by importance × novelty")),
        ("outlining", String(localized: "Outline"), String(localized: "150 s here, 90 s there: named cuts")),
        ("writing", String(localized: "Writing"), String(localized: "≈1,500 words, documentary register")),
        ("grounding", String(localized: "Checking"), String(localized: "Every sentence against its source")),
        ("editing", String(localized: "Editing"), String(localized: "Blocklist: zero tics on air")),
        ("tts", String(localized: "Narration"), String(localized: "Documentary voice")),
        ("assembling", String(localized: "Assembling"), String(localized: "Chapters joined, level set")),
        ("ready", String(localized: "Ready"), String(localized: "Kept + set aside, with reasons")),
    ]

    private var currentIndex: Int { Self.stages.firstIndex { $0.status == status } ?? 0 }
    private var isReady: Bool { status == "ready" }
    private var isFailed: Bool { status == "failed" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Overline(text: String(localized: "GENERATING"), color: Palette.accentDeep)
                    Spacer(minLength: 8)
                    Button("Close") { dismiss() }
                        .typo(Typo.navButton)
                        .foregroundStyle(Palette.accentDeep)
                }
                .padding(.bottom, 12)

                Text(isFailed ? String(localized: "The generation stopped.") : isReady ? String(localized: "Your briefing is ready.") : String(localized: "Your briefing is being built."))
                    .typo(Typo.playerTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted)
                    .padding(.top, 6)
                    .padding(.bottom, 18)

                PlainCard(cornerRadius: 16, padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(Self.stages.enumerated()), id: \.offset) { index, stage in
                            stageRow(index: index, label: stage.label, caption: stage.caption)
                            if index < Self.stages.count - 1 {
                                Rectangle().fill(Palette.hairline).frame(height: 1)
                            }
                        }
                    }
                }

                if let failure {
                    Text(failure)
                        .typo(Typo.metaSmall)
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)
                }

                if isReady, let detail {
                    Button {
                        EpisodePlayer.shared.open(detail)
                        dismiss()
                    } label: {
                        Text("Episode ready · open it")
                            .typo(Typo.buttonLarge)
                            .foregroundStyle(Palette.onDark)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Palette.ink, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 18)
                }
            }
            .padding(20)
        }
        .background(ScreenBackground())
        .presentationDragIndicator(.visible)
        .task { await follow() }
    }

    private var subtitle: String {
        if let sec = detail?.targetSec {
            return String(localized: "Nine editorial steps · target \(sec / 60) min")
        }
        return String(localized: "Nine editorial steps")
    }

    private func stageRow(index: Int, label: String, caption: String) -> some View {
        let done = isReady ? index <= currentIndex : index < currentIndex
        let active = !isReady && !isFailed && index == currentIndex
        return HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(done ? Palette.ink : Color.clear)
                    .overlay(Circle().strokeBorder(done || active ? Palette.ink : Palette.cardBorder, lineWidth: 1.5))
                    .frame(width: 24, height: 24)
                if done {
                    Text("✓").typo(Typo.metaTiny).foregroundStyle(Palette.onDark)
                } else if active {
                    ProgressView().controlSize(.mini).tint(Palette.ink)
                } else {
                    Text(String(index + 1)).typo(Typo.metaTiny).foregroundStyle(Palette.muted2).tabularNumerals()
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .typo(Typo.listTitle)
                    .foregroundStyle(done || active ? Palette.ink : Palette.muted)
                Text(caption)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .opacity(done || active ? 1 : 0.7)
    }

    /// Reads the row every few seconds until it settles. Four seconds is slow
    /// enough to cost nothing and fast enough that a stage never looks stuck.
    private func follow() async {
        while !Task.isCancelled {
            do {
                let fresh = try await API.shared.episode(id: episodeId)
                detail = fresh
                if fresh.status != status {
                    status = fresh.status
                    if fresh.status == "ready" { Feedback.saved() }
                    if fresh.status == "failed" { Feedback.refused() }
                }
                if fresh.status == "ready" || fresh.status == "failed" {
                    if fresh.status == "failed" { failure = String(localized: "The run stopped before publishing. Try again from Today.") }
                    return
                }
            } catch {
                failure = error.localizedDescription
            }
            try? await Task.sleep(for: .seconds(4))
        }
    }
}
