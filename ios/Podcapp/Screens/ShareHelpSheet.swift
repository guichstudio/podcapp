import SwiftUI

/// The share gesture in three steps, for the person who has never used an iOS
/// share sheet with a third-party app. Text from the v3 design.
struct ShareHelpSheet: View {
    @Environment(\.dismiss) private var dismiss

    private var steps: [(glyph: String, title: String, sub: String)] {
        [
            ("↑", String(localized: "Tap Share"), String(localized: "From Safari, YouTube, Mail, X…")),
            ("◉", String(localized: "Pick Podcapp"), String(localized: "In the iOS share sheet")),
            ("✓", String(localized: "Captured in 1 s"), String(localized: "You stay in your app · the analysis runs in the background")),
        ]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Overline(text: String(localized: "HOW TO SHARE"), color: Palette.accentDeep)
                    Spacer(minLength: 8)
                    Button("Close") { dismiss() }
                        .typo(Typo.navButton)
                        .foregroundStyle(Palette.accentDeep)
                }
                .padding(.bottom, 12)

                Text("How to share a link in Podcapp")
                    .typo(Typo.playerTitle)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 18)

                PlainCard(cornerRadius: 16, padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                            HStack(spacing: 14) {
                                ZStack {
                                    Circle().fill(Palette.ink).frame(width: 30, height: 30)
                                    Text(String(index + 1)).typo(Typo.buttonSmall).foregroundStyle(Palette.onDark)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(step.title).typo(Typo.listTitle).foregroundStyle(Palette.ink)
                                    Text(step.sub).typo(Typo.metaSmall).foregroundStyle(Palette.muted2)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Text(step.glyph).typo(Typo.navButton).foregroundStyle(Palette.muted2)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            if index < steps.count - 1 {
                                Rectangle().fill(Palette.hairline).frame(height: 1)
                            }
                        }
                    }
                }

                Text("Newsletters go by email: forward them to your ingest address once it is set up.")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted2)
                    .padding(.top, 14)
            }
            .padding(20)
        }
        .background(ScreenBackground())
        .presentationDragIndicator(.visible)
        .presentationDetents([.medium, .large])
    }
}
