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
        case .sources: return String(localized: "Library")
        case .settings: return String(localized: "Settings")
        }
    }

    /// SF Symbols standing in for the line icons in v3.html's tab bar (a
    /// calendar, an open book, a list and adjustment sliders) — those are
    /// bespoke SVG paths with no font-glyph equivalent, so the system's own
    /// line-icon vocabulary is the nearest honest match.
    var icon: String {
        switch self {
        case .today: return "calendar"
        case .read: return "book"
        case .sources: return "line.3.horizontal"
        case .settings: return "slider.horizontal.3"
        }
    }
}

struct RootView: View {
    @State private var tab: RootTab = .today
    // A tab keeps its scroll position and its loaded rows once it has been
    // opened, and no tab calls the API before it is first shown.
    @State private var opened: Set<RootTab> = [.today]
    // Ties the selection pill in every tab button to one moving element:
    // matchedGeometryEffect diffs the two frames and animates between them.
    @Namespace private var tabSelection

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
                    // Fast response so the pill reads as attached to your tap,
                    // with damping high enough that it settles into the new
                    // tab rather than overshooting and wobbling back.
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                        tab = candidate
                    }
                    opened.insert(candidate)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: candidate.icon)
                            .font(.system(size: 17))
                        Text(candidate.label)
                            .typo(Typo.tabLabel)
                    }
                    .foregroundStyle(candidate == tab ? Palette.ink : Palette.tabInactive)
                    .padding(.top, 8)
                    .padding(.bottom, 7)
                    .frame(maxWidth: .infinity)
                    .background {
                        // A bare Capsule has no intrinsic size, so it must ride
                        // along in .background rather than sit beside the label
                        // in a ZStack — background is guaranteed the label's
                        // already-resolved frame, where a ZStack sibling would
                        // be free to propose its own (and blow up to fill the
                        // screen, which is exactly what happened here first).
                        if candidate == tab {
                            Capsule()
                                .fill(Palette.ink.opacity(0.07))
                                .matchedGeometryEffect(id: "selectedTab", in: tabSelection)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(candidate.label)
                .accessibilityAddTraits(candidate == tab ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(5)
        .background {
            Capsule()
                .fill(Palette.tabBarFill)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay {
                    // The design's box-shadow carries a 1px white inset highlight
                    // along the top edge on top of the solid border; SwiftUI has
                    // no inset-shadow primitive, so the border itself fades from
                    // brighter (top) to the base alpha (bottom) to fake it.
                    Capsule().strokeBorder(
                        LinearGradient(
                            colors: [Color.white.opacity(0.95), Palette.tabBarBorder],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
                }
                .shadow(color: Palette.tabBarShadow, radius: 22, y: 18)
        }
        // Floats above the safe area rather than sitting flush against it —
        // the prototype insets the pill from all three edges instead of
        // docking a full-width bar to the bottom.
        .padding(.horizontal, 14)
        .padding(.bottom, 16)
    }
}

#Preview {
    RootView()
}
