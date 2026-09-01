import SwiftUI
import UIKit

// The App Store onboarding from ios/design/onboarding-layout.html (the FR
// screens of the "vfinal" 2026-08-31 export), as the first run of the app. The
// design's artboards are full 393x852 device screens, so every element carries
// the html's absolute coordinates: pages lay out header, headline and pager
// bar in flow, then an ArtboardCanvas positions the design's blocks at their
// own x/y. Page order follows the export: Écoutez, Construit, Tous les
// formats, Partagez, Lisez, Connexion.
//
// The design's sixth screen offers "Continuer avec Apple" and "Continuer avec
// Google". Neither exists: the product authenticates with a per-user token that
// is issued by hand, and Sign in with Apple would need a paid developer account
// and a backend that does not exist. Rather than ship two buttons that cannot
// work, that screen keeps the design's layout and puts the token field and the
// Continuer button where the OAuth buttons sit.

struct OnboardingView: View {
    let onDone: () -> Void

    @State private var token = ""
    @State private var status: ConnectStatus = .idle
    @State private var page: Int? = 0
    @FocusState private var tokenFocused: Bool
    /// How much of the screen the keyboard covers. The shell ignores the
    /// keyboard safe area to keep the pages at their design geometry, which
    /// also means nothing here moves on its own: the connect page has to be
    /// told, or the token field stays under the keyboard with no way to reach
    /// it — which is exactly what happened.
    @State private var keyboard: CGFloat = 0

    private static let fieldAnchor = "token-field"

    private static let pageCount = 6

    private func go(_ delta: Int) {
        let current = page ?? 0
        let target = min(Self.pageCount - 1, max(0, current + delta))
        guard target != current else { return }
        Feedback.select()
        withAnimation(.easeInOut(duration: 0.3)) { page = target }
    }

    enum ConnectStatus: Equatable { case idle, checking, failed(String) }

    var body: some View {
        ZStack {
            OnboardingBackground()
            VStack(spacing: 0) {
                header
                // A native paging ScrollView rather than the page TabView: the
                // UIKit pager re-applies the home-indicator inset to its pages
                // no matter what the hierarchy ignores, which pinned a strip of
                // background under the bezel. This one is plain SwiftUI layout.
                GeometryReader { geo in
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 0) {
                            Group {
                                ListenPage().id(0)
                                BuiltPage().id(1)
                                FormatsPage().id(2)
                                SharePage().id(3)
                                ReadPage().id(4)
                                connectPage.id(5)
                            }
                            .frame(width: geo.size.width, height: geo.size.height)
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.paging)
                    .scrollIndicators(.hidden)
                    // Tap navigation on top of the swipe: a strip on each side
                    // pages back/forward, like a story viewer. Plain tap
                    // gestures, so the drag still belongs to the ScrollView.
                    .overlay {
                        // 44pt, not wider: on a 375pt phone the connect page's
                        // 272pt column leaves only 51.5pt of margin per side.
                        HStack(spacing: 0) {
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture { go(-1) }
                                .frame(width: 44)
                            Spacer(minLength: 0)
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture { go(1) }
                                .frame(width: 44)
                        }
                    }
                    .scrollPosition(id: $page)
                }
                .environment(\.pagerNav, PagerNav(prev: { go(-1) }, next: { go(1) }))
            }
        }
        // At the ROOT: the pager is a scroll view and clips at its own bounds,
        // so it must physically reach the bottom edge for the bezel to bleed
        // off-screen. Anything less leaves a strip of background under the cut.
        .ignoresSafeArea(edges: .bottom)
        // Keyboard avoidance squeezed the whole shell when the token field took
        // focus: the headline slid under the header, texts truncated. The shell
        // keeps its geometry; the connect page scrolls instead.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
            let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            // The page ignores the bottom safe area, so the keyboard's own
            // height is exactly what it hides. No screen arithmetic needed.
            withAnimation(.easeOut(duration: 0.25)) { keyboard = frame?.height ?? 0 }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            withAnimation(.easeOut(duration: 0.25)) { keyboard = 0 }
        }
        .onAppear { Config.markOnboardingSeen() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            AppMark(size: 26)
            Text("Podcapp")
                .typo(TypoStyle(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
            Text("b" + (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"))
                .typo(Typo.metaTiny)
                .foregroundStyle(Palette.ink.opacity(0.2))
        }
        .padding(.top, 26)
        .frame(maxWidth: .infinity)
    }

    private var connectPage: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                connectContent
            }
            // The inset is what makes this scrollable at all while typing: the
            // shell holds the page at full height, so without it the content
            // still fits and the scroll view has nothing to scroll.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: keyboard)
            }
            // Fires on the keyboard, not on the focus: focus arrives first, and
            // scrolling before the inset exists lands on the same spot.
            .onChange(of: keyboard) { _, height in
                guard height > 0, tokenFocused else { return }
                withAnimation(.easeOut(duration: 0.3)) {
                    proxy.scrollTo(Self.fieldAnchor, anchor: .center)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("OK") { tokenFocused = false }
                }
            }
            // Centers like the fixed layout while content fits; scrolls only
            // when the keyboard shortens the visible area.
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private var connectContent: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Shall we?"), second: String(localized: "Two seconds."),
                left: Sparkle("✦", 14, Onbo.accent, x: 20, y: -6),
                right: Sparkle("✧", 10, Palette.ink, x: 22, y: 28)
            )
            .padding(.top, 20)
            PagerBar(fill: 1.0)

            AppMark(size: tokenFocused ? 64 : 96)
                .shadow(color: Onbo.floatShadow.opacity(0.28), radius: 27, y: 24)
                .padding(.top, tokenFocused ? 24 : 87)
            Text("Welcome to Podcapp")
                .fs(19, .semibold)
                .foregroundStyle(Palette.ink)
                .padding(.top, 22)
            // The markup's dash is replaced per the house punctuation rule.
            Text("Your daily radio: sourced by you, checked by us")
                .fs(12, lh: 1.55)
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 230)
                .padding(.top, 12)

            // The token field and the Continuer button take the exact slot of
            // the design's OAuth buttons: same width, radii and dark treatment.
            VStack(spacing: 11) {
                SecureField("API token", text: $token)
                    // Inside the horizontal paging ScrollView the field never
                    // became first responder on its own: the tap died somewhere
                    // in the nested scroll views, so the token could not be
                    // typed OR pasted, which is the whole point of this screen.
                    // Buttons on the same page work, and the same field works in
                    // Réglages, so the focus is claimed by hand here.
                    .contentShape(Rectangle())
                    .onTapGesture { tokenFocused = true }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { Task { await connect() } }
                    .focused($tokenFocused)
                    .fs(13.5)
                    .multilineTextAlignment(.center)
                    .padding(15)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.white.opacity(0.6)))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(.white.opacity(0.75)))
                    .shadow(color: Onbo.floatShadow.opacity(0.16), radius: 12, y: 10)
                Button {
                    Task { await connect() }
                } label: {
                    HStack(spacing: 8) {
                        if status == .checking { ProgressView().tint(.white) }
                        Text(status == .checking ? "Connexion" : "Continuer")
                            .fs(13.5, .semibold)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Onbo.darkChip.opacity(token.isEmpty ? 0.4 : 0.88)))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(.white.opacity(0.14)))
                    .shadow(color: Color(hex: 0x1C1B22, opacity: 0.3), radius: 14, y: 12)
                }
                .buttonStyle(.plain)
                .disabled(token.isEmpty || status == .checking)
            }
            .frame(width: 272)
            .padding(.top, tokenFocused ? 20 : 32)
            .id(Self.fieldAnchor)

            if case let .failed(message) = status {
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
                    .frame(width: 272)
                    .padding(.top, 10)
            }

            Text("No password · private RSS feed included")
                .fs(10)
                .foregroundStyle(Palette.faint)
                .padding(.top, 22)

            Spacer(minLength: 0)
        }
        // Tapping the empty space puts the keyboard away. It has to sit BEHIND
        // the content: the same gesture on the scroll view covered the token
        // field as well and won it, so a tap on the field focused and unfocused
        // it in one go and nothing could ever be typed.
        .background(
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { tokenFocused = false }
        )
    }

    // A real round trip: the only honest way to know the token works is to use it.
    private func connect() async {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        Config.apiToken = trimmed
        status = .checking
        do {
            _ = try await API.shared.episodes()
            tokenFocused = false
            onDone()
        } catch {
            Config.apiToken = ""
            status = .failed(error.localizedDescription)
        }
    }
}

// MARK: - Onboarding-only design tokens

// Colors that appear only in onboarding-layout.html, so they live here and not
// in Palette, which is decoded from the main layout.
private enum Onbo {
    /// Headline accent, step badges and the share button: #5B4DBE.
    static let accent = Color(hex: 0x5B4DBE)
    /// Safari chrome and the Mail icon: #3D8BFD.
    static let safariBlue = Color(hex: 0x3D8BFD)
    /// Caption under the formats card: #55525E.
    static let caption = Color(hex: 0x55525E)
    /// Dark toast fill, rgba(24,23,32,...) before its opacity.
    static let darkChip = Color(hex: 0x181720)
    /// Glass card shadow, rgba(50,42,110,...) before its opacity.
    static let floatShadow = Color(hex: 0x322A6E)
    /// Pager chevrons: #8A87A0.
    static let pagerChevron = Color(hex: 0x8A87A0)

    /// The html artboards are full 393x852 device screens.
    static let artboardW: CGFloat = 393
    static let artboardH: CGFloat = 852
    /// Where the canvas starts in artboard coordinates: header (52), headline
    /// (20 + 71) and pager bar (18 + 15) of the design's own flow.
    static let canvasTop: CGFloat = 235
    /// The phone mock's absolute top on every phone screen.
    static let phoneTop: CGFloat = 252
    /// The closed phone body: interior 660 plus 2x10 bezel padding. In the
    /// html its bottom (252 + 680 = 932) bleeds 80pt past the 852 artboard;
    /// Louis wants the full bezel on screen instead, so phone pages fit the
    /// canvas down to closedBottom (phone bottom plus breathing room above
    /// the home indicator).
    static let phoneHeight: CGFloat = 680
    static let closedBottom: CGFloat = phoneTop + phoneHeight + 44
}

private extension View {
    /// The mocks use one-off sizes everywhere, so this wraps TypoStyle inline:
    /// size, face, letter-spacing (em) and CSS line-height in one short call.
    func fs(_ size: CGFloat, _ weight: Typo.Weight = .regular, track: CGFloat = 0, lh: CGFloat = 0) -> some View {
        typo(TypoStyle(size: size, weight: weight, trackingEm: track, lineHeight: lh))
    }

    /// The frosted white chip floating over the mocks.
    func glassFloat(radius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return background(shape.fill(.white.opacity(0.58)))
            .overlay(shape.strokeBorder(.white.opacity(0.72)))
            .shadow(color: Onbo.floatShadow.opacity(0.25), radius: 20, y: 18)
    }

    /// The dark rounded toast used across the mocks.
    func darkPill() -> some View {
        background(Capsule().fill(Onbo.darkChip.opacity(0.8)))
            .overlay(Capsule().strokeBorder(.white.opacity(0.16)))
            .shadow(color: Color(hex: 0x1C1B22, opacity: 0.35), radius: 15, y: 14)
    }

    /// Absolute positioning at the html's artboard coordinates, inside an
    /// ArtboardCanvas (whose top is artboard y 235). Apply AFTER rotation so
    /// the box lands where the css left/top put it.
    func artboard(x: CGFloat, y: CGFloat) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .offset(x: x, y: y - Onbo.canvasTop)
    }

    /// Horizontally centered variant, for left:50% / translateX(-50%) blocks.
    func artboardCentered(y: CGFloat, xNudge: CGFloat = 0) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .offset(x: xNudge, y: y - Onbo.canvasTop)
    }

    /// Right-anchored variant, for css right:N.
    func artboardTrailing(right: CGFloat, y: CGFloat) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .offset(x: -right, y: y - Onbo.canvasTop)
    }
}

// MARK: - Headline, pager bar, canvas

private struct Sparkle {
    let glyph: String
    let size: CGFloat
    let color: Color
    let x: CGFloat
    let y: CGFloat

    init(_ glyph: String, _ size: CGFloat, _ color: Color, x: CGFloat, y: CGFloat) {
        self.glyph = glyph
        self.size = size
        self.color = color
        self.x = x
        self.y = y
    }
}

private struct OnboardingHeadline: View {
    let first: String
    let second: String
    let left: Sparkle
    let right: Sparkle

    var body: some View {
        (Text(first) + Text("\n") + Text(second).foregroundStyle(Onbo.accent))
            .typo(TypoStyle(size: 33, weight: .semibold, trackingEm: -0.02, lineHeight: 1.08))
            .foregroundStyle(Palette.ink)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .topLeading) {
                Text(left.glyph)
                    .font(.system(size: left.size))
                    .foregroundStyle(left.color)
                    .offset(x: left.x, y: left.y)
            }
            .overlay(alignment: .topTrailing) {
                Text(right.glyph)
                    .font(.system(size: right.size))
                    .foregroundStyle(right.color)
                    .offset(x: -right.x, y: right.y)
            }
    }
}

/// Back/forward actions for the pager, injected by the shell so the per-page
/// PagerBar chevrons can navigate without every page threading closures.
struct PagerNav {
    var prev: () -> Void = {}
    var next: () -> Void = {}
}

private struct PagerNavKey: EnvironmentKey {
    static let defaultValue = PagerNav()
}

extension EnvironmentValues {
    var pagerNav: PagerNav {
        get { self[PagerNavKey.self] }
        set { self[PagerNavKey.self] = newValue }
    }
}

/// The design's page indicator under each headline: chevrons around a 134pt
/// track whose fill encodes the position (17% to 100%). The chevrons page
/// back and forward; the fill is still static per page, like the html.
private struct PagerBar: View {
    let fill: CGFloat

    @Environment(\.pagerNav) private var nav

    var body: some View {
        HStack(spacing: 14) {
            chevron("‹", action: nav.prev)
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.ink.opacity(0.12))
                Capsule().fill(Palette.ink).frame(width: 134 * fill)
            }
            .frame(width: 134, height: 4)
            chevron("›", action: nav.next)
        }
        .padding(.top, 18)
    }

    private func chevron(_ glyph: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph)
                .fs(15)
                .foregroundStyle(Onbo.pagerChevron)
                // A 15pt glyph is an impossible tap target: pad the hit area
                // without moving the visual.
                .padding(12)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(-12)
    }
}

/// The zone under the pager bar. Children carry the html's absolute artboard
/// coordinates via .artboard()/.artboardCentered(); the whole artboard scales
/// uniformly (down only) so everything up to fitBottom stays on screen. Phone
/// pages pass Onbo.closedBottom so the full bezel is visible with the design's
/// proportions intact; pages without a phone keep the default artboard height.
private struct ArtboardCanvas<Content: View>: View {
    private let fitBottom: CGFloat
    private let content: Content

    init(fitBottom: CGFloat = Onbo.artboardH, @ViewBuilder content: () -> Content) {
        self.fitBottom = fitBottom
        self.content = content()
    }

    var body: some View {
        GeometryReader { geo in
            let designH = fitBottom - Onbo.canvasTop
            let scale = min(1, geo.size.width / Onbo.artboardW, geo.size.height / designH)
            ZStack(alignment: .topLeading) { content }
                .frame(width: Onbo.artboardW, height: designH, alignment: .topLeading)
                .scaleEffect(scale, anchor: .top)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .clipped()
    }
}

/// The dark phone frame the mocks live in: bezel gradient, three concentric
/// rings, side buttons, top bezel sheen, dynamic island and a screen clipped
/// at radius 35. The height is the design's closed 680pt body; on phone pages
/// its bottom bleeds past the screen edge.
private struct PhoneFrame<Screen: View>: View {
    let height: CGFloat
    let screenFill: AnyShapeStyle
    private let screen: () -> Screen

    init(height: CGFloat, screenFill: AnyShapeStyle, @ViewBuilder screen: @escaping () -> Screen) {
        self.height = height
        self.screenFill = screenFill
        self.screen = screen
    }

    var body: some View {
        ZStack(alignment: .top) {
            ring(spread: 4.9, fill: Color(hex: 0x100E16, opacity: 0.85))
            ring(spread: 3.6, fill: Color(hex: 0x52505C))
            ring(spread: 1.4, fill: Color(hex: 0xF4F3F8, opacity: 0.32))
            RoundedRectangle(cornerRadius: 47, style: .continuous)
                .fill(LinearGradient(
                    colors: [Color(hex: 0x111014), Color(hex: 0x0B0A0E)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
                .frame(width: 302, height: height)
            RoundedRectangle(cornerRadius: 47, style: .continuous)
                .fill(LinearGradient(
                    stops: [
                        .init(color: .white.opacity(0.1), location: 0),
                        .init(color: .white.opacity(0), location: 0.14),
                    ],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: 302, height: height)
            sideButton(y: 132, height: 24, edge: -1)
            sideButton(y: 176, height: 42, edge: -1)
            sideButton(y: 228, height: 42, edge: -1)
            sideButton(y: 196, height: 66, edge: 1)
            screenBody
                .padding(.top, 10)
        }
        .compositingGroup()
        .shadow(color: Color(hex: 0x0A0814, opacity: 0.5), radius: 26, y: 58)
        .shadow(color: Color(hex: 0x1C1B22, opacity: 0.38), radius: 10, y: 24)
    }

    private func ring(spread: CGFloat, fill: Color) -> some View {
        RoundedRectangle(cornerRadius: 47 + spread, style: .continuous)
            .fill(fill)
            .frame(width: 302 + spread * 2, height: height + spread * 2)
            .offset(y: -spread)
    }

    private func sideButton(y: CGFloat, height h: CGFloat, edge: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(LinearGradient(
                colors: edge < 0
                    ? [Color(hex: 0x75727F), Color(hex: 0x38363F)]
                    : [Color(hex: 0x38363F), Color(hex: 0x75727F)],
                startPoint: .leading, endPoint: .trailing
            ))
            .frame(width: 5, height: h)
            .offset(x: edge * 154.5, y: y)
    }

    private var screenBody: some View {
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 35, style: .continuous).fill(screenFill)
            screen()
            island
            reflection
        }
        .frame(width: 282, height: height - 20)
        .clipShape(RoundedRectangle(cornerRadius: 35, style: .continuous))
    }

    private var island: some View {
        Capsule()
            .fill(Color(hex: 0x0A0A0C))
            .frame(width: 92, height: 26)
            .overlay(alignment: .trailing) {
                Circle()
                    .fill(RadialGradient(
                        colors: [Color(hex: 0x2E3A52), Color(hex: 0x10131C), .black],
                        center: UnitPoint(x: 0.35, y: 0.35), startRadius: 0, endRadius: 7
                    ))
                    .frame(width: 11, height: 11)
                    .padding(.trailing, 7)
            }
            .padding(.top, 8)
    }

    private var reflection: some View {
        RoundedRectangle(cornerRadius: 35, style: .continuous)
            .fill(LinearGradient(
                stops: [
                    .init(color: .white.opacity(0.16), location: 0),
                    .init(color: .white.opacity(0.05), location: 0.2),
                    .init(color: .white.opacity(0), location: 0.38),
                    .init(color: .white.opacity(0), location: 0.82),
                    .init(color: .white.opacity(0.05), location: 1),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .overlay(RoundedRectangle(cornerRadius: 35, style: .continuous)
                .strokeBorder(.white.opacity(0.06)))
            .frame(width: 282, height: height - 20)
            .allowsHitTesting(false)
    }
}

/// Track plus filled portion, the tiny progress bars in the mocks.
private struct MockProgress: View {
    let fraction: CGFloat
    let height: CGFloat
    let tint: Color
    let track: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(tint).frame(width: geo.size.width * fraction)
            }
        }
        .frame(height: height)
    }
}

// MARK: - Screen 01, Écoutez

private struct ListenPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Your morning"), second: String(localized: "recap."),
                left: Sparkle("✦", 14, Onbo.accent, x: 20, y: -8),
                right: Sparkle("✧", 10, Palette.ink, x: 22, y: 26)
            )
            .padding(.top, 20)
            PagerBar(fill: 0.17)
            ArtboardCanvas {
                subtitle
                    .artboardCentered(y: 300)
                mediaCard(glyph: "¶", title: String(localized: "Article"), sub: String(localized: "12 min read"))
                    .rotationEffect(.degrees(-5))
                    .artboard(x: 40, y: 402)
                mediaCard(glyph: "▶", title: String(localized: "Video"), sub: String(localized: "28 min to watch"))
                    .rotationEffect(.degrees(3))
                    .artboardTrailing(right: 40, y: 478)
                mediaCard(glyph: "↗", title: String(localized: "Link"), sub: String(localized: "40-post thread"))
                    .rotationEffect(.degrees(-2))
                    .artboard(x: 40, y: 554)
                bottomStack
                    .artboardCentered(y: 668)
            }
        }
    }

    // Inline weight changes need Text concatenation, so this one bypasses
    // .typo() and uses the faces directly (600 maps to the Bold face, like
    // Typo's semibold).
    private var subtitle: some View {
        (Text("Everything you never had time to ")
            + Text("read").font(.custom("InterTight-Bold", size: 19)).foregroundColor(Palette.ink)
            + Text(" or ")
            + Text("watch").font(.custom("InterTight-Bold", size: 19)).foregroundColor(Palette.ink)
            + Text("."))
            .font(.custom("InterTight-Light", size: 19))
            .foregroundColor(Color(hex: 0x3B3945))
            .multilineTextAlignment(.center)
            .lineSpacing(6)
            .frame(width: 289)
    }

    private func mediaCard(glyph: String, title: String, sub: String) -> some View {
        HStack(spacing: 12) {
            Text(glyph)
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Palette.ink))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).fs(14, .semibold, lh: 1.25).foregroundStyle(Palette.ink)
                Text(sub).fs(10).foregroundStyle(Palette.muted2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("✓")
                .fs(11, .semibold)
                .foregroundStyle(Onbo.accent)
                .padding(.vertical, 4)
                .padding(.horizontal, 9)
                .background(Capsule().fill(Color(hex: 0x7C6CDC, opacity: 0.16)))
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 15)
        .frame(width: 246)
        .glassFloat(radius: 18)
    }

    private var bottomStack: some View {
        VStack(spacing: 11) {
            Text("↓").font(.system(size: 16)).foregroundStyle(Onbo.pagerChevron)
            AppMark(size: 58)
                .shadow(color: Onbo.floatShadow.opacity(0.28), radius: 18, y: 16)
            Text("≈ 5 min of audio · every morning")
                .fs(11, .semibold)
                .foregroundStyle(.white)
                .padding(.vertical, 9)
                .padding(.horizontal, 16)
                .darkPill()
        }
    }
}

// MARK: - Screen 02b, Tous les formats

private struct FormatsPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Anything goes in."), second: String(localized: "Really, anything."),
                left: Sparkle("✧", 12, Palette.ink, x: 20, y: -4),
                right: Sparkle("✦", 14, Onbo.accent, x: 22, y: 26)
            )
            .padding(.top, 20)
            PagerBar(fill: 0.5)
            ArtboardCanvas {
                formatsCard
                    .artboardCentered(y: 290)
                Text("✓ One gesture: Share → Podcapp")
                    .fs(11, .semibold)
                    .foregroundStyle(.white)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .darkPill()
                    .rotationEffect(.degrees(-2))
                    .artboardCentered(y: 670, xNudge: -2.5)
                Text("Videos transcribed automatically · newsletters by forward")
                    .fs(11)
                    .foregroundStyle(Onbo.caption)
                    .artboardCentered(y: 735)
            }
        }
    }

    private var formatsCard: some View {
        VStack(spacing: 0) {
            formatRow("YouTube", String(localized: "video"), divider: true) {
                appIcon(AnyShapeStyle(Color(hex: 0xFF0033))) {
                    Text("▶").font(.system(size: 12)).foregroundStyle(.white)
                }
            }
            formatRow("Facebook", String(localized: "video · article"), divider: true) {
                appIcon(AnyShapeStyle(Color(hex: 0x1877F2))) {
                    Text("f").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                }
            }
            formatRow("Instagram", "post · reel", divider: true) {
                appIcon(AnyShapeStyle(LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0xF58529), location: 0),
                        .init(color: Color(hex: 0xDD2A7B), location: 0.55),
                        .init(color: Color(hex: 0x8134AF), location: 1),
                    ],
                    startPoint: .bottomLeading, endPoint: .topTrailing
                ))) { instagramGlyph }
            }
            formatRow("X · Twitter", "lien · thread", divider: true) {
                appIcon(AnyShapeStyle(Palette.ink)) {
                    Text("𝕏").font(.system(size: 13)).foregroundStyle(.white)
                }
            }
            formatRow("PDF", "document", divider: true) {
                appIcon(AnyShapeStyle(Palette.danger)) {
                    Text("PDF").fs(8, .semibold, track: 0.04).foregroundStyle(.white)
                }
            }
            formatRow("Mail", "newsletter", divider: false) {
                appIcon(AnyShapeStyle(Onbo.safariBlue)) {
                    Image(systemName: "envelope")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(6)
        .frame(width: 300)
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(.white.opacity(0.52)))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(.white.opacity(0.75)))
        .shadow(color: Onbo.floatShadow.opacity(0.22), radius: 30, y: 24)
    }

    private func formatRow(_ name: String, _ tag: String, divider: Bool, @ViewBuilder icon: () -> some View) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                icon()
                Text(name).fs(14, .semibold).foregroundStyle(Palette.ink)
                Spacer()
                Text(tag).fs(11).foregroundStyle(Palette.muted2)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            if divider {
                Rectangle().fill(Palette.hairline).frame(height: 1)
            }
        }
    }

    private func appIcon(_ fill: AnyShapeStyle, @ViewBuilder glyph: () -> some View) -> some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(fill)
            .frame(width: 34, height: 34)
            .overlay(glyph())
            .shadow(color: Color(hex: 0x1C1B22, opacity: 0.14), radius: 5, y: 4)
    }

    private var instagramGlyph: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(.white, lineWidth: 1.8)
                .frame(width: 16, height: 16)
            Circle().strokeBorder(.white, lineWidth: 1.8).frame(width: 8, height: 8)
            Circle().fill(.white).frame(width: 2.4, height: 2.4).offset(x: 4.6, y: -4.6)
        }
    }
}

// MARK: - Screen 03, Construit

private struct BuiltPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Built by you,"), second: String(localized: "checked by us."),
                left: Sparkle("✦", 14, Onbo.accent, x: 20, y: 2),
                right: Sparkle("✧", 10, Palette.ink, x: 22, y: -8)
            )
            .padding(.top, 20)
            PagerBar(fill: 0.33)
            ArtboardCanvas(fitBottom: Onbo.closedBottom) {
                PhoneFrame(height: Onbo.phoneHeight, screenFill: AnyShapeStyle(LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0xE4DFF5), location: 0),
                        .init(color: Color(hex: 0xF4F3EF), location: 0.6),
                    ],
                    startPoint: .top, endPoint: .bottom
                ))) {
                    ZStack(alignment: .top) {
                        playerScreen
                        statsFloat
                            .offset(x: -1, y: 579)
                    }
                }
                .artboardCentered(y: Onbo.phoneTop)
                claimFloat(
                    chip: "VRAI", color: Palette.success, fill: Palette.successBg,
                    text: String(localized: "Blue Owl −40 % · marché ≈ 1 800 Md$ · défaut First Brands"),
                    width: 196
                )
                .rotationEffect(.degrees(-6))
                .artboard(x: 11, y: 582)
                claimFloat(
                    chip: "FAKE", color: Palette.warning, fill: Palette.warningBg,
                    text: String(localized: "«sur la semaine» → «en une semaine» date non établie"),
                    width: 190
                )
                .rotationEffect(.degrees(5))
                .artboard(x: 177.5, y: 658)
            }
        }
    }

    private var playerScreen: some View {
        VStack(spacing: 12) {
            AppMark(size: 64)
                .shadow(color: Onbo.floatShadow.opacity(0.25), radius: 17, y: 14)
                .padding(.top, 8)
            Text("CHAPTER 1 OF 4")
                .fs(8, .semibold, track: 0.1)
                .foregroundStyle(Palette.accentMuted)
            Text("Private credit, Wall Street’s cockroach")
                .fs(15, .semibold, lh: 1.2)
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 210)
            MockProgress(fraction: 0.34, height: 3.5, tint: Palette.ink, track: Palette.ink.opacity(0.14))
                .frame(width: 205)
            HStack(spacing: 10) {
                Text("⏮").font(.system(size: 12)).foregroundStyle(Palette.ink)
                skipButton("−15")
                Text("❚❚")
                    .font(.system(size: 14))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Palette.ink))
                    .shadow(color: Palette.ink.opacity(0.3), radius: 11, y: 10)
                skipButton("+15")
                Text("⏭").font(.system(size: 12)).foregroundStyle(Palette.ink)
            }
            sourceCard
                .padding(.top, 4)
        }
        .frame(width: 250)
        .padding(.top, 50)
    }

    private func skipButton(_ label: String) -> some View {
        Text(label)
            .fs(7.5, .semibold)
            .foregroundStyle(Palette.ink)
            .frame(width: 30, height: 30)
            .overlay(Circle().strokeBorder(Palette.ink.opacity(0.16)))
    }

    private var sourceCard: some View {
        HStack(spacing: 8) {
            Text("SOURCE").fs(7, .semibold, track: 0.08).foregroundStyle(Palette.accentMuted)
            // The markup's dash is replaced per the house punctuation rule.
            Text("THE ECHO · “You loved subprime…”")
                .fs(8.5, .semibold)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("↗").font(.system(size: 9)).foregroundStyle(Palette.faint)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 11)
        .frame(width: 220)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.72)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(Palette.ink.opacity(0.09)))
    }

    private var statsFloat: some View {
        HStack(spacing: 14) {
            stat("42", String(localized: "checked"))
            statDivider
            stat("4", String(localized: "rewritten"))
            statDivider
            stat("0", String(localized: "unsourced"))
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 14)
        .glassFloat(radius: 14)
        .rotationEffect(.degrees(-2))
    }

    private func stat(_ number: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(number).fs(17, .semibold).foregroundStyle(Palette.ink)
            Text(label).fs(8).foregroundStyle(Palette.muted)
        }
    }

    private var statDivider: some View {
        Rectangle().fill(Palette.ink.opacity(0.1)).frame(width: 1, height: 28)
    }

    private func claimFloat(chip: String, color: Color, fill: Color, text: String, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(chip)
                .fs(8, .semibold, track: 0.06)
                .foregroundStyle(color)
                .padding(.vertical, 3)
                .padding(.horizontal, 8)
                .background(Capsule().fill(fill))
            Text(text)
                .fs(10.5, .semibold, lh: 1.35)
                .foregroundStyle(Palette.ink)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(width: width, alignment: .leading)
        .glassFloat(radius: 13)
    }
}

// MARK: - Screen 02, Partagez

private struct SharePage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Share it."), second: String(localized: "It’s captured."),
                left: Sparkle("✧", 12, Palette.ink, x: 20, y: -6),
                right: Sparkle("✦", 14, Onbo.accent, x: 22, y: 30)
            )
            .padding(.top, 20)
            PagerBar(fill: 0.67)
            ArtboardCanvas(fitBottom: Onbo.closedBottom) {
                PhoneFrame(height: Onbo.phoneHeight, screenFill: AnyShapeStyle(Color(hex: 0xFAFAF8))) {
                    ZStack(alignment: .top) {
                        articleContent
                        Color(hex: 0x14121E, opacity: 0.22)
                        stepsFloat
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .offset(x: 16, y: 208)
                        capturedToast
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .offset(x: 130, y: 318)
                        // The html's bottom offsets (240 and 70) assume the
                        // interior is cropped at 590; shifted down for the
                        // closed phone, same gap between the two bars.
                        actionBar
                            .frame(maxHeight: .infinity, alignment: .bottom)
                            .padding(.bottom, 182)
                            .padding(.horizontal, 6)
                        shareSheet
                            .frame(maxHeight: .infinity, alignment: .bottom)
                            .padding(.bottom, 12)
                            .padding(.horizontal, 6)
                    }
                }
                .artboardCentered(y: Onbo.phoneTop)
            }
        }
    }

    private var articleContent: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("🔒 lecho.be")
                .fs(10)
                .foregroundStyle(Palette.body)
                .padding(.vertical, 7)
                .padding(.horizontal, 11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Palette.ink.opacity(0.06)))
            Text("YOUR ARTICLE")
                .fs(8, .semibold, track: 0.08)
                .foregroundStyle(Onbo.accent)
                .padding(.vertical, 3)
                .padding(.horizontal, 8)
                .background(Capsule().fill(Color(hex: 0x7C6CDC, opacity: 0.14)))
                .overlay(Capsule().strokeBorder(Color(hex: 0x7C6CDC, opacity: 0.3)))
            Text("“You loved subprime, you are going to love the private credit crisis”")
                .fs(15, .semibold, lh: 1.22)
                .foregroundStyle(Palette.ink)
            HStack(spacing: 6) {
                Text("ECHO")
                    .fs(4.5, .semibold)
                    .foregroundStyle(.white)
                    .frame(width: 14, height: 14)
                    .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Palette.ink))
                Text("The Echo · Markets · 28 August 2026").fs(9).foregroundStyle(Palette.muted2)
            }
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(LinearGradient(
                    colors: [Palette.ink.opacity(0.16), Palette.ink.opacity(0.07)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
                .frame(height: 84)
                .overlay(
                    Text("▶")
                        .font(.system(size: 11))
                        .foregroundStyle(.white)
                        .padding(.leading, 2)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Palette.ink.opacity(0.55)))
                )
            skeleton(1)
            skeleton(0.94)
            skeleton(0.88)
            Text("Blue Owl, First Brands: the dominoes")
                .fs(10, .semibold)
                .foregroundStyle(Palette.ink)
                .padding(.top, 2)
            skeleton(0.96)
            skeleton(0.7)
        }
        .frame(width: 250, alignment: .leading)
        .padding(.top, 46)
    }

    private func skeleton(_ fraction: CGFloat) -> some View {
        Capsule().fill(Palette.ink.opacity(0.1)).frame(width: 250 * fraction, height: 6)
    }

    private var stepsFloat: some View {
        VStack(alignment: .leading, spacing: 9) {
            stepRow("1", "Touchez Partager")
            stepRow("2", "Choisissez Podcapp")
            // The markup's dash is replaced per the house punctuation rule.
            Text("That’s it: you stay in your app.")
                .fs(9, lh: 1.35)
                .foregroundStyle(Palette.muted2)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 13)
        .frame(width: 178, alignment: .leading)
        .glassFloat(radius: 14)
        .rotationEffect(.degrees(-6))
    }

    private func stepRow(_ number: String, _ label: String) -> some View {
        HStack(spacing: 8) {
            Text(number)
                .fs(10, .semibold)
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Circle().fill(Onbo.accent))
            Text(label).fs(11, .semibold).foregroundStyle(Palette.ink)
        }
    }

    private var capturedToast: some View {
        HStack(spacing: 8) {
            Text("✓")
                .fs(9, .semibold)
                .foregroundStyle(.white)
                .frame(width: 17, height: 17)
                .background(Circle().fill(Color(hex: 0x3BC55A)))
            Text("Captured in 1s").fs(11.5, .semibold).foregroundStyle(.white)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 15)
        .darkPill()
        .rotationEffect(.degrees(6))
    }

    private var actionBar: some View {
        HStack {
            Text("‹").fs(14, .semibold).foregroundStyle(Onbo.safariBlue)
            Spacer()
            Text("›").fs(14, .semibold).foregroundStyle(Onbo.safariBlue.opacity(0.4))
            Spacer()
            shareButton
            Spacer()
            Text("☐").font(.system(size: 13)).foregroundStyle(Onbo.safariBlue.opacity(0.4))
            Spacer()
            Text("⧉").font(.system(size: 13)).foregroundStyle(Onbo.safariBlue.opacity(0.4))
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 20)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(hex: 0xFCFCFA, opacity: 0.82)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(.white.opacity(0.6)))
        .shadow(color: Color(hex: 0x14121E, opacity: 0.2), radius: 12, y: 8)
    }

    private var shareButton: some View {
        Circle()
            .fill(Onbo.accent)
            .frame(width: 42, height: 42)
            .background(Circle().fill(Color(hex: 0x7C6CDC, opacity: 0.35)).frame(width: 52, height: 52))
            .overlay(Image(systemName: "square.and.arrow.up")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white))
            .shadow(color: Onbo.accent.opacity(0.45), radius: 10, y: 8)
            .overlay(alignment: .topTrailing) {
                Text("1")
                    .fs(10, .semibold)
                    .foregroundStyle(.white)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Palette.ink))
                    .offset(x: 8, y: -6)
            }
    }

    private var shareSheet: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Palette.ink.opacity(0.2))
                .frame(width: 28, height: 3.5)
                .padding(.top, 2)
                .padding(.bottom, 8)
            HStack(spacing: 8) {
                Text("ECHO")
                    .fs(6.5, .semibold)
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Palette.ink))
                Text("“You loved subprime…”")
                    .fs(10, .semibold)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.bottom, 9)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Palette.ink.opacity(0.09)).frame(height: 1)
            }
            HStack(alignment: .top, spacing: 11) {
                shareApp("Messages") { messagesIcon }
                shareApp("Mail") { mailIcon }
                shareApp("Podcapp", bold: true) { podcappIcon }
                shareApp(String(localized: "Copy")) { copyIcon }
            }
            .padding(.top, 10)
        }
        .padding(.top, 8)
        .padding(.horizontal, 12)
        .padding(.bottom, 14)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(Color(hex: 0xFCFCFA, opacity: 0.85)))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .strokeBorder(.white.opacity(0.6)))
    }

    private func shareApp(_ label: String, bold: Bool = false, @ViewBuilder icon: () -> some View) -> some View {
        VStack(spacing: 4) {
            icon()
            Text(label)
                .fs(7.5, bold ? .semibold : .regular)
                .foregroundStyle(bold ? Palette.ink : Palette.muted)
        }
    }

    private var messagesIcon: some View {
        RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(LinearGradient(colors: [Color(hex: 0x67E763), Color(hex: 0x2FBF44)],
                                 startPoint: .top, endPoint: .bottom))
            .frame(width: 38, height: 38)
            .overlay(Image(systemName: "message.fill")
                .font(.system(size: 18))
                .foregroundStyle(.white))
    }

    private var mailIcon: some View {
        RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(Onbo.safariBlue)
            .frame(width: 38, height: 38)
            .overlay(Image(systemName: "envelope")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white))
    }

    private var podcappIcon: some View {
        AppMark(size: 38)
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(Palette.accent, lineWidth: 2.5))
            .shadow(color: Color(hex: 0x6B5BCC, opacity: 0.4), radius: 8, y: 6)
            .overlay(alignment: .topTrailing) {
                Text("2")
                    .fs(9, .semibold)
                    .foregroundStyle(.white)
                    .frame(width: 16, height: 16)
                    .background(Circle().fill(Onbo.accent))
                    .offset(x: 7, y: -5)
            }
    }

    private var copyIcon: some View {
        RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(Palette.ink.opacity(0.08))
            .frame(width: 38, height: 38)
            .overlay(Text("⧉").font(.system(size: 12)).foregroundStyle(Palette.body))
    }
}

// MARK: - Screen 04, Lisez

private struct ReadPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: String(localized: "Listen…"), second: String(localized: "or read."),
                left: Sparkle("✧", 11, Palette.ink, x: 20, y: -4),
                right: Sparkle("✦", 14, Onbo.accent, x: 22, y: 24)
            )
            .padding(.top, 20)
            PagerBar(fill: 0.83)
            ArtboardCanvas {
                modeRow
                    .artboardCentered(y: 302)
                translationCard
                    .rotationEffect(.degrees(-2))
                    .artboardCentered(y: 398)
                Text("✓ Every source, summed up in your language")
                    .fs(11, .semibold)
                    .foregroundStyle(.white)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .darkPill()
                    .rotationEffect(.degrees(2))
                    .artboardCentered(y: 640)
            }
        }
    }

    private var modeRow: some View {
        HStack(spacing: 12) {
            modePill(String(localized: "▶ Listen"))
            Text("⇄")
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Palette.ink))
                .shadow(color: Palette.ink.opacity(0.35), radius: 13, y: 11)
            modePill(String(localized: "¶ Read"))
        }
    }

    private func modePill(_ label: String) -> some View {
        Text(label)
            .fs(13, .semibold)
            .foregroundStyle(Palette.ink)
            .padding(.vertical, 11)
            .padding(.horizontal, 18)
            .background(Capsule().fill(.white.opacity(0.58)))
            .overlay(Capsule().strokeBorder(.white.opacity(0.75)))
            .shadow(color: Onbo.floatShadow.opacity(0.18), radius: 15, y: 12)
    }

    private var translationCard: some View {
        VStack(spacing: 0) {
            // The markup's dashes are replaced per the house punctuation rule.
            langRow(code: String(localized: "onboarding.source.lang"), badge: Onbo.pagerChevron) {
                Text("onboarding.source.quote")
                    .fs(12.5, lh: 1.45)
                    .foregroundStyle(Onbo.caption)
            }
            HStack(spacing: 10) {
                dividerLine
                Text("↓ TRANSLATED · SUMMED UP")
                    .fs(9.5, .semibold, track: 0.08)
                    .foregroundStyle(Onbo.accent)
                    .fixedSize()
                dividerLine
            }
            .padding(.vertical, 13)
            langRow(code: String(localized: "onboarding.recap.lang"), badge: Onbo.accent) {
                Text("onboarding.recap.quote")
                    .fs(13.5, .semibold, lh: 1.4)
                    .foregroundStyle(Palette.ink)
            }
            Text("Sources in another language? Your recap stays in yours.")
                .fs(10.5)
                .foregroundStyle(Palette.muted2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
                .overlay(alignment: .top) {
                    Rectangle().fill(Palette.ink.opacity(0.08)).frame(height: 1)
                }
                .padding(.top, 14)
        }
        .padding(18)
        .frame(width: 296)
        .glassFloat(radius: 22)
    }

    private func langRow(code: String, badge: Color, @ViewBuilder text: () -> some View) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(code)
                .fs(9, .semibold, track: 0.06)
                .foregroundStyle(.white)
                .padding(.vertical, 4)
                .padding(.horizontal, 7)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(badge))
            text()
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var dividerLine: some View {
        Rectangle().fill(Palette.ink.opacity(0.1)).frame(height: 1)
    }
}

// MARK: - Background and app mark

// The onboarding's own gradient and the two radial glows behind it, from the
// design. The app's screens use the flatter ScreenBackground instead.
private struct OnboardingBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: Color(hex: 0xF1EDFB), location: 0),
                    .init(color: Color(hex: 0xE6E0F6), location: 0.62),
                    .init(color: Color(hex: 0xDCD4F1), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            RadialGradient(
                colors: [Color(hex: 0x7C6CDC, opacity: 0.5), Color(hex: 0x7C6CDC, opacity: 0)],
                center: .init(x: 0.05, y: 0.02), startRadius: 0, endRadius: 260
            )
            RadialGradient(
                colors: [Color(hex: 0x6096FF, opacity: 0.38), Color(hex: 0x6096FF, opacity: 0)],
                center: .init(x: 0.95, y: 0.95), startRadius: 0, endRadius: 280
            )
        }
        .ignoresSafeArea()
    }
}

struct AppMark: View {
    var size: CGFloat = 26

    var body: some View {
        // UIImage(named:) resolves the bundled Resources/logo.png, which is how
        // TodayView already loads it: no asset catalog entry needed.
        Image(uiImage: UIImage(named: "logo") ?? UIImage())
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
    }
}
