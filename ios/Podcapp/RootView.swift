import SwiftUI

// The shell of ios/design/layout.html: the gradient every screen sits on, the
// four screens, the custom glass tab bar at the bottom, and the mini player
// floating just above it.
//
// There is no shared state object here on purpose. The only thing the shell
// owns is which tab is showing; the current episode and the playback belong to
// EpisodePlayer.shared, which the mini bar and the full player already read.

enum RootTab: String, CaseIterable, Identifiable {
    case today, read, sources, settings

    var id: String { rawValue }

    /// Labels and glyphs from the `tabs` table in ios/design/component.jsx.
    var label: String {
        switch self {
        case .today: return String(localized: "Today")
        case .read: return String(localized: "Read")
        case .sources: return String(localized: "Sources")
        case .settings: return String(localized: "Settings")
        }
    }

    /// U+FE0E on the cog: without the variation selector iOS picks its emoji
    /// form and the icon comes out in colour, ignoring the tab's tint.
    var icon: String {
        switch self {
        case .today: return "\u{25CF}"
        case .read: return "\u{00B6}"
        case .sources: return "\u{2630}"
        case .settings: return "\u{2699}\u{FE0E}"
        }
    }
}

struct RootView: View {
    @State private var tab: RootTab = .today
    // A tab keeps its scroll position and its loaded rows once it has been
    // opened, and no tab calls the API before it is first shown.
    @State private var opened: Set<RootTab> = [.today]

    var body: some View {
        ZStack {
            ScreenBackground()

            ZStack {
                ForEach(RootTab.allCases) { candidate in
                    if opened.contains(candidate) {
                        screen(candidate)
                            .opacity(candidate == tab ? 1 : 0)
                            .allowsHitTesting(candidate == tab)
                            .accessibilityHidden(candidate != tab)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    MiniPlayerBar()
                    tabBar
                }
            }
        }
    }

    @ViewBuilder
    private func screen(_ tab: RootTab) -> some View {
        switch tab {
        case .today:
            TodayView()
        case .read:
            // The Read tab hands over a chapter index, not a timecode: the
            // player is the only place that knows the timeline.
            ReadView { episode, chapterIndex in
                EpisodePlayer.shared.open(episode, chapterIndex: chapterIndex)
            }
        case .sources:
            LibraryView()
        case .settings:
            SettingsView()
        }
    }

    // MARK: - Tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(RootTab.allCases) { candidate in
                Button {
                    // Silent on the tab you are already on: a tab bar that
                    // ticks when nothing moves reads as a glitch.
                    if candidate != tab { Feedback.select() }
                    tab = candidate
                    opened.insert(candidate)
                } label: {
                    VStack(spacing: 3) {
                        Text(candidate.icon)
                            .font(Typo.font(size: 17, weight: .regular))
                        Text(candidate.label)
                            .typo(Typo.tabLabel)
                    }
                    .foregroundStyle(candidate == tab ? Palette.ink : Palette.faint)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(candidate.label)
                .accessibilityAddTraits(candidate == tab ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .background {
            // The bar's own bottom padding in the design is the home indicator
            // strip, which the safe area already reserves: the material just has
            // to reach the physical edge.
            Rectangle()
                .fill(Color(hex: 0xFAFAF8, opacity: 0.82))
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Palette.cardBorder)
                .frame(height: 1)
        }
    }
}

#Preview {
    RootView()
}
