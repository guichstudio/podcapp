import SwiftUI

// The App Store onboarding from ios/design/onboarding-layout.html (FR screens
// "01 Écoutez" through "05 Connexion"), as the first run of the app. Five pages
// tell what the product does, the sixth connects it. The mock cards are
// illustrations: their strings are hardcoded from the markup on purpose.
//
// The design's sixth screen offers "Continuer avec Apple" and "Continuer avec
// Google". Neither exists: the product authenticates with a per-user token that
// is issued by hand, and Sign in with Apple would need a paid developer account
// and a backend that does not exist. Rather than ship two buttons that cannot
// work, that screen keeps the design's layout and puts the token field and the
// Continuer button where the OAuth buttons sit.
//
// The design frames are 380x800 with no pager chrome; the app adds a header,
// dots and a footer around the pages, so vertical gaps are compressed (never
// elements dropped) and each phone mock bleeds past a clipped canvas exactly
// like the design's overflow:hidden crop.

struct OnboardingView: View {
    let onDone: () -> Void

    @State private var page = 0
    @State private var token = ""
    @State private var status: ConnectStatus = .idle
    @FocusState private var tokenFocused: Bool

    enum ConnectStatus: Equatable { case idle, checking, failed(String) }

    private static let pageCount = 5

    var body: some View {
        ZStack {
            OnboardingBackground()
            VStack(spacing: 0) {
                header
                TabView(selection: $page) {
                    ListenPage().tag(0)
                    SharePage().tag(1)
                    FormatsPage().tag(2)
                    BuiltPage().tag(3)
                    ReadPage().tag(4)
                    connectPage.tag(Self.pageCount)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                dots
                footer
            }
            .padding(.bottom, 28)
        }
        // Keyboard avoidance squeezed the whole shell when the token field took
        // focus: the headline slid under the header, texts truncated, the dots
        // overlapped the button. The shell keeps its geometry; the connect page
        // scrolls instead.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onAppear { Config.markOnboardingSeen() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            AppMark(size: 26)
            Text("Podcapp")
                .typo(TypoStyle(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
        }
        .padding(.top, 26)
        .frame(maxWidth: .infinity)
    }

    private var dots: some View {
        HStack(spacing: 6) {
            ForEach(0...Self.pageCount, id: \.self) { i in
                Capsule()
                    .fill(i == page ? Palette.accentDeep : Palette.ink.opacity(0.16))
                    .frame(width: i == page ? 18 : 6, height: 6)
                    .animation(.snappy(duration: 0.25), value: page)
            }
        }
        .padding(.bottom, 22)
    }

    @ViewBuilder private var footer: some View {
        if page < Self.pageCount {
            HStack(spacing: 12) {
                Button("Passer") { page = Self.pageCount }
                    .typo(Typo.buttonMedium)
                    .foregroundStyle(Palette.muted)
                Spacer()
                Button {
                    withAnimation(.snappy(duration: 0.3)) { page += 1 }
                } label: {
                    Text("Continuer")
                        .typo(Typo.buttonLarge)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 30)
                        .padding(.vertical, 15)
                        .background(Capsule().fill(Palette.ink))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 28)
        }
    }

    // MARK: - Screen 05, Connexion

    private var connectPage: some View {
        ScrollView(showsIndicators: false) {
            connectContent
        }
        .scrollDismissesKeyboard(.interactively)
        // Centers like the fixed layout while content fits; scrolls only when
        // the keyboard shortens the visible area.
        .scrollBounceBehavior(.basedOnSize)
    }

    private var connectContent: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: "On commence ?", second: "2 secondes.",
                left: Sparkle("✦", 14, Onbo.accent, x: 56, y: -6),
                right: Sparkle("✧", 10, Palette.ink, x: 64, y: 28)
            )
            .padding(.top, 14)

            AppMark(size: 96)
                .shadow(color: Onbo.floatShadow.opacity(0.28), radius: 27, y: 24)
                .padding(.top, 34)
            Text("Bienvenue sur Podcapp")
                .fs(19, .semibold)
                .foregroundStyle(Palette.ink)
                .padding(.top, 22)
            Text("Votre radio quotidienne, sourcé par vous, vérifié par nous")
                .fs(12, lh: 1.55)
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 230)
                .padding(.top, 12)

            // The token field and the Continuer button take the exact slot of
            // the design's OAuth buttons: same width, radii and dark treatment.
            VStack(spacing: 11) {
                SecureField("Jeton d’API", text: $token)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
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
            .frame(width: 264)
            .padding(.top, 32)

            if case let .failed(message) = status {
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
                    .multilineTextAlignment(.center)
                    .frame(width: 264)
                    .padding(.top, 10)
            }

            Text("Aucun mot de passe · flux RSS privé inclus")
                .fs(10)
                .foregroundStyle(Palette.faint)
                .padding(.top, 22)

            Spacer(minLength: 0)
        }
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
}

// MARK: - Headline with sparkles

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

// MARK: - Mock scaffolding

/// The zone under a headline: takes whatever height the page has left and clips
/// its overflow, the same crop the design's 380x800 frames apply. Children are
/// positioned against the top with offsets; the closure receives the zone size
/// so the phone can be drawn tall enough to bleed past the bottom edge.
private struct MockCanvas<Content: View>: View {
    private let content: (CGSize) -> Content

    init(@ViewBuilder content: @escaping (CGSize) -> Content) {
        self.content = content
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                content(geo.size)
            }
            // The 6pt inset keeps the bezel's outer rings inside the clip.
            .padding(.top, 6)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .clipped()
    }
}

/// The dark phone frame the mocks live in: bezel gradient, three concentric
/// rings, side buttons, dynamic island and a screen clipped at radius 35. The
/// height is oversized by the caller so the bottom edge never shows.
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
            sideButton(y: 132, height: 24, edge: -1)
            sideButton(y: 176, height: 42, edge: -1)
            sideButton(y: 228, height: 42, edge: -1)
            sideButton(y: 196, height: 66, edge: 1)
            screenBody
                .padding(.top, 10)
        }
        .compositingGroup()
        .shadow(color: Color(hex: 0x0A0814, opacity: 0.55), radius: 55, y: 55)
        .shadow(color: Color(hex: 0x1C1B22, opacity: 0.42), radius: 22, y: 22)
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
                first: "Trop à lire ?", second: "Écoutez.",
                left: Sparkle("✦", 14, Onbo.accent, x: 58, y: -8),
                right: Sparkle("✧", 10, Palette.ink, x: 62, y: 26)
            )
            .padding(.top, 14)
            MockCanvas { size in
                PhoneFrame(height: size.height + 60, screenFill: AnyShapeStyle(Color(hex: 0xFAFAF8))) {
                    homeScreen
                }
                briefingFloat
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .offset(x: 20, y: 325)
                speedFloat
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .offset(x: -20, y: 422)
            }
            .padding(.top, 16)
        }
    }

    private var homeScreen: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 6) {
                    AppMark(size: 20)
                    Text("Podcapp").fs(13, .semibold).foregroundStyle(Palette.ink)
                }
                Spacer()
                Text("LUN. 31 AOÛT").fs(9, .semibold, track: 0.08).foregroundStyle(Palette.muted)
            }
            heroCard
            Text("Demain").fs(12, .semibold).foregroundStyle(Palette.ink)
            HStack(alignment: .top, spacing: 6) {
                tomorrowCard(title: "Contagion du crédit privé", sub: "2 sources")
                tomorrowCard(title: "L'économie des agents", sub: "Extraction…")
            }
        }
        .frame(width: 250, alignment: .leading)
        .padding(.top, 46)
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DERNIER BRIEFING · VEN. 28 AOÛT")
                .fs(8, .semibold, track: 0.1)
                .foregroundStyle(Palette.accentDeep)
            Text("Le cafard de Wall Street, Claude passe des ordres, les douze fins de l'IA…")
                .fs(14.5, .semibold, lh: 1.2)
                .foregroundStyle(Palette.ink)
            HStack(spacing: 8) {
                Text("▶ Écouter")
                    .fs(10.5, .semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Palette.ink))
                Text("10:05 · 4 chapitres").fs(9.5).foregroundStyle(Palette.accentMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.glassFill))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.glassBorder))
    }

    private func tomorrowCard(title: String, sub: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).fs(9, .semibold, lh: 1.3).foregroundStyle(Palette.ink)
            Text(sub).fs(9, lh: 1.3).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.8)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.cardBorder))
    }

    private var briefingFloat: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                AppMark(size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Briefing de vendredi").fs(11, .semibold, lh: 1.2).foregroundStyle(Palette.ink)
                    Text("10:05 · ✓ 42 phrases vérifiées").fs(9).foregroundStyle(Palette.muted)
                }
            }
            MockProgress(fraction: 0.38, height: 3, tint: Onbo.accent, track: Palette.ink.opacity(0.1))
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 13)
        .frame(width: 190, alignment: .leading)
        .glassFloat(radius: 14)
        .rotationEffect(.degrees(-7))
    }

    private var speedFloat: some View {
        Text("1,2× ▸▸ +15")
            .fs(11, .semibold)
            .foregroundStyle(.white)
            .padding(.vertical, 9)
            .padding(.horizontal, 14)
            .darkPill()
            .rotationEffect(.degrees(5))
    }
}

// MARK: - Screen 02, Partagez

private struct SharePage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: "Partagez.", second: "C'est capturé.",
                left: Sparkle("✧", 12, Palette.ink, x: 66, y: -6),
                right: Sparkle("✦", 14, Onbo.accent, x: 56, y: 30)
            )
            .padding(.top, 14)
            MockCanvas { size in
                PhoneFrame(height: size.height + 60, screenFill: AnyShapeStyle(Color(hex: 0xFAFAF8))) {
                    ZStack(alignment: .top) {
                        articleContent
                        Color(hex: 0x14121E, opacity: 0.38)
                        stepsFloat
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .offset(x: 25, y: 130)
                        capturedToast
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .offset(x: 130, y: 228)
                    }
                }
                // Fixed height, not maxHeight: the canvas ZStack is stretched
                // by the oversized phone, so a flexible frame would grow with
                // it and push these bars past the clip edge.
                VStack(spacing: 10) {
                    actionBar
                    shareSheet
                }
                .frame(width: 270)
                .frame(height: size.height - 18, alignment: .bottom)
                .frame(maxWidth: .infinity)
            }
            .padding(.top, 16)
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
            Text("«Vous avez aimé les subprimes, vous allez adorer la crise des crédits privés»")
                .fs(13.5, .semibold, lh: 1.25)
                .foregroundStyle(Palette.ink)
            skeleton(1)
            skeleton(0.88)
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Palette.ink.opacity(0.07))
                .frame(height: 64)
                .overlay(Text("▸").font(.system(size: 15)).foregroundStyle(Palette.faint))
            skeleton(0.92)
        }
        .frame(width: 250, alignment: .leading)
        .padding(.top, 46)
    }

    private func skeleton(_ fraction: CGFloat) -> some View {
        Capsule().fill(Palette.ink.opacity(0.08)).frame(width: 250 * fraction, height: 6)
    }

    private var stepsFloat: some View {
        VStack(alignment: .leading, spacing: 9) {
            stepRow("1", "Touchez Partager")
            stepRow("2", "Choisissez Podcapp")
            // The markup's dash is replaced per the house punctuation rule.
            Text("C'est tout : vous restez sur votre app.")
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
            Text("Capturé en 1 s").fs(11.5, .semibold).foregroundStyle(.white)
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
                Text("«Vous avez aimé les subprimes…»")
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
                shareApp("Copier") { copyIcon }
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

// MARK: - Screen 02b, Tous les formats

private struct FormatsPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: "Tout y passe.", second: "Vraiment tout.",
                left: Sparkle("✧", 12, Palette.ink, x: 60, y: -4),
                right: Sparkle("✦", 14, Onbo.accent, x: 58, y: 26)
            )
            .padding(.top, 14)
            formatsCard
                .padding(.top, 26)
            Text("Vidéos transcrites automatiquement · newsletters par transfert")
                .fs(11)
                .foregroundStyle(Onbo.caption)
                .padding(.top, 14)
            Spacer(minLength: 8)
            Text("✓ Un seul geste : Partager → Podcapp")
                .fs(11, .semibold)
                .foregroundStyle(.white)
                .padding(.vertical, 10)
                .padding(.horizontal, 16)
                .darkPill()
                .rotationEffect(.degrees(-2))
                .padding(.bottom, 6)
        }
    }

    private var formatsCard: some View {
        VStack(spacing: 0) {
            formatRow("YouTube", "vidéo", divider: true) {
                appIcon(AnyShapeStyle(Color(hex: 0xFF0033))) {
                    Text("▶").font(.system(size: 12)).foregroundStyle(.white)
                }
            }
            formatRow("Facebook", "vidéo · article", divider: true) {
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
        .frame(width: 290)
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
                first: "Construit,", second: "par vous.",
                left: Sparkle("✦", 14, Onbo.accent, x: 54, y: 2),
                right: Sparkle("✧", 10, Palette.ink, x: 68, y: -8)
            )
            .padding(.top, 14)
            MockCanvas { size in
                PhoneFrame(height: size.height + 60, screenFill: AnyShapeStyle(LinearGradient(
                    stops: [
                        .init(color: Color(hex: 0xE4DFF5), location: 0),
                        .init(color: Color(hex: 0xF4F3EF), location: 0.6),
                    ],
                    startPoint: .top, endPoint: .bottom
                ))) {
                    playerScreen
                }
                claimFloat(
                    chip: "VÉRIFIÉ", color: Palette.success, fill: Palette.successBg,
                    text: "Blue Owl −40 % · marché ≈ 1 800 Md$ · défaut First Brands",
                    width: 196, angle: -6
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .offset(x: 67, y: 300)
                claimFloat(
                    chip: "CORRIGÉ", color: Palette.warning, fill: Palette.warningBg,
                    text: "«sur la semaine» → «en une semaine» date non établie",
                    width: 190, angle: 5
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .offset(x: 174, y: 348)
                // Fixed height for the same reason as the SharePage bars.
                statsFloat
                    .frame(height: size.height - 20, alignment: .bottom)
                    .frame(maxWidth: .infinity)
            }
            .padding(.top, 16)
        }
    }

    private var playerScreen: some View {
        VStack(spacing: 12) {
            AppMark(size: 64)
                .shadow(color: Onbo.floatShadow.opacity(0.25), radius: 17, y: 14)
                .padding(.top, 8)
            Text("CHAPITRE 1 SUR 4")
                .fs(8, .semibold, track: 0.1)
                .foregroundStyle(Palette.accentMuted)
            Text("Crédit privé, le cafard de Wall Street")
                .fs(15, .semibold, lh: 1.2)
                .foregroundStyle(Palette.ink)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 210)
            MockProgress(fraction: 0.34, height: 3.5, tint: Palette.ink, track: Palette.ink.opacity(0.14))
                .frame(width: 250 * 0.82)
            transport
        }
        .frame(width: 250)
        .padding(.top, 50)
    }

    private var transport: some View {
        HStack(spacing: 10) {
            // The markup's ⏮ and ⏭ render as emoji on iOS, so the same shapes
            // come from SF Symbols instead.
            Image(systemName: "backward.end.fill")
                .font(.system(size: 11))
                .foregroundStyle(Palette.ink)
            skipButton("−15")
            Text("❚❚")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Palette.ink))
                .shadow(color: Color(hex: 0x1C1B22, opacity: 0.3), radius: 11, y: 10)
            skipButton("+15")
            Image(systemName: "forward.end.fill")
                .font(.system(size: 11))
                .foregroundStyle(Palette.ink)
        }
    }

    private func skipButton(_ label: String) -> some View {
        Text(label)
            .fs(7.5, .semibold)
            .foregroundStyle(Palette.ink)
            .frame(width: 30, height: 30)
            .overlay(Circle().strokeBorder(Palette.ink.opacity(0.16)))
    }

    private func claimFloat(chip: String, color: Color, fill: Color, text: String, width: CGFloat, angle: Double) -> some View {
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
        .rotationEffect(.degrees(angle))
    }

    private var statsFloat: some View {
        HStack(spacing: 14) {
            statCell("42", "vérifiées")
            statDivider
            statCell("4", "réécrites")
            statDivider
            statCell("0", "non sourcée")
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 14)
        .glassFloat(radius: 14)
        .rotationEffect(.degrees(-2))
    }

    private func statCell(_ number: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(number).fs(17, .semibold).foregroundStyle(Palette.ink)
            Text(label).fs(8).foregroundStyle(Palette.muted)
        }
    }

    private var statDivider: some View {
        Rectangle().fill(Palette.ink.opacity(0.1)).frame(width: 1, height: 26)
    }
}

// MARK: - Screen 04, Lisez

private struct ReadPage: View {
    var body: some View {
        VStack(spacing: 0) {
            OnboardingHeadline(
                first: "Écoutez…", second: "ou lisez.",
                left: Sparkle("✧", 11, Palette.ink, x: 62, y: -4),
                right: Sparkle("✦", 14, Onbo.accent, x: 54, y: 24)
            )
            .padding(.top, 14)
            MockCanvas { size in
                PhoneFrame(height: size.height + 60, screenFill: AnyShapeStyle(Color(hex: 0xFAFAF8))) {
                    readerScreen
                }
                quiverFloat
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .offset(x: 82, y: 392)
                readFloat
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .offset(x: 235, y: 433)
            }
            .padding(.top, 16)
        }
    }

    private var readerScreen: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("‹ Tous les épisodes").fs(9, .semibold).foregroundStyle(Palette.accentDeep)
            Text("BRIEFING DU VENDREDI · 28 AOÛT")
                .fs(7.5, .semibold, track: 0.1)
                .foregroundStyle(Palette.accentMuted)
            Text("Le cafard de Wall Street, Claude passe des ordres, les douze fins de l'IA…")
                .fs(14.5, .semibold, lh: 1.2)
                .foregroundStyle(Palette.ink)
            Text("10:05 · 4 sources · ✓ vérifié")
                .fs(8.5)
                .foregroundStyle(Palette.muted2)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Palette.ink.opacity(0.09)).frame(height: 1)
                }
            chapterRow("01", "Crédit privé, le cafard de Wall Street", "2:30")
            Text("On commence à Wall Street, où un mot revient avec insistance : cafard. La formule est de Jamie Dimon, le patron de JP Morgan : quand on en voit un, c'est qu'il y en a probablement d'autres. Le cafard en question, c'est le crédit privé, un marché estimé à plus de mille huit cents milliards de dollars…")
                .fs(9.5, .light, lh: 1.65)
                .foregroundStyle(Palette.prose)
            HStack(spacing: 7) {
                Text("▶ Écouter ici")
                    .fs(8, .semibold)
                    .foregroundStyle(Palette.ink)
                    .padding(.vertical, 5)
                    .padding(.horizontal, 9)
                    .background(Capsule().fill(Palette.ink.opacity(0.04)))
                    .overlay(Capsule().strokeBorder(Palette.ink.opacity(0.14)))
                Text("Source : L'ECHO")
                    .underline()
                    .fs(8, .semibold)
                    .foregroundStyle(Palette.accentDeep)
            }
            chapterRow("02", "Claude passe des ordres de bourse", "2:10")
                .padding(.top, 4)
            Text("Quiver Quantitative a publié ce vendredi une démonstration qui résume bien le moment…")
                .fs(9.5, .light, lh: 1.65)
                .foregroundStyle(Palette.prose)
        }
        .frame(width: 250, alignment: .leading)
        .padding(.top, 48)
    }

    private func chapterRow(_ number: String, _ title: String, _ time: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(number).fs(8.5, .semibold).foregroundStyle(Palette.accentMid)
            Text(title)
                .fs(11.5, .semibold)
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(time).fs(8).foregroundStyle(Palette.muted2)
        }
    }

    private var quiverFloat: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("QUIVER QUANTITATIVE").fs(8, .semibold).foregroundStyle(Palette.body)
            Text("Claude passe des ordres via les données du Congrès")
                .fs(10, .semibold, lh: 1.3)
                .foregroundStyle(Palette.ink)
                .padding(.top, 5)
            Text("vidéo + post · EN")
                .fs(8)
                .foregroundStyle(Palette.muted2)
                .padding(.top, 3)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(width: 217, alignment: .leading)
        .glassFloat(radius: 13)
        .rotationEffect(.degrees(-7))
    }

    private var readFloat: some View {
        Text("¶ Lire l'article")
            .fs(11, .semibold)
            .foregroundStyle(.white)
            .padding(.vertical, 9)
            .padding(.horizontal, 14)
            .darkPill()
            .rotationEffect(.degrees(4))
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
