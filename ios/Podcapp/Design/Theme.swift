import CoreText
import SwiftUI
import UIKit

// Design tokens decoded from the v3 prototype (/tmp/podcapp-shots/v3.html).
// Every value below was read off that prototype's markup or its live computed
// styles: screens read from here and never hardcode a color or a size.
//
// Two conversions apply throughout, because the prototype is CSS:
//   - a CSS blur radius is twice SwiftUI's, so `0 16px 40px` becomes
//     `radius: 20, y: 16` (see `Shadow`);
//   - the bundled faces cover font-weight 300 (Light), 400-500 (Regular) and
//     600-800 (SemiBold), so the prototype's 500 is `.regular` and its 700
//     is `.semibold`.

// MARK: - Colors

enum Palette {
    // Text
    static let ink = Color(hex: 0x1C1B22)
    static let ink2 = Color(hex: 0x3B3945)
    static let body = Color(hex: 0x4A4854)
    static let muted = Color(hex: 0x6E6C78)
    static let muted2 = Color(hex: 0x77747E)
    static let faint = Color(hex: 0xA5A2AC)
    static let fainter = Color(hex: 0xB0ADB6)
    static let prose = Color(hex: 0x2E2C36)
    static let onDark = Color.white
    /// Secondary line inside a selected dark tile (the voice picker's subtitle).
    static let onDarkMuted = Color.white.opacity(0.7)
    /// Ring around a generation step that has not started yet.
    static let stepRing = Color(hex: 0xC9C6D2)

    // Accents
    static let accentDeep = Color(hex: 0x5B51A8)
    static let accent = Color(hex: 0x7C6CDC)
    static let accentMid = Color(hex: 0x6F68A8)
    static let accentMuted = Color(hex: 0x6F6A96)
    static let accentDark = Color(hex: 0x3F3B58)
    /// End stop of the call-to-action gradient, and of the mini player's bar.
    static let accentEnd = Color(hex: 0x5B4DBE)
    /// End stop of the airtime-budget bars in the backstage report.
    static let accentSoft = Color(hex: 0xA99CF0)
    /// Tinted callout: the dedupe banner, the onboarding schedule pill.
    static let accentTint = Color(hex: 0x7C6CDC, opacity: 0.12)
    static let accentTintBorder = Color(hex: 0x7C6CDC, opacity: 0.24)

    // Status pairs (foreground on background)
    static let success = Color(hex: 0x2E7D46)
    static let successBg = Color(hex: 0x2E7D46, opacity: 0.12)
    static let warning = Color(hex: 0x9A6B00)
    static let warningBg = Color(hex: 0x9A6B00, opacity: 0.12)
    static let danger = Color(hex: 0xB54334)
    static let dangerBg = Color(hex: 0xB54334, opacity: 0.12)
    static let neutralChip = Color(hex: 0x4A4854)
    static let neutralChipBg = Color(hex: 0x1C1B22, opacity: 0.07)
    static let airedChip = Color(hex: 0x77747E)
    static let airedChipBg = Color(hex: 0x1C1B22, opacity: 0.05)
    /// The discarded-source callout in the backstage report: a chip on a tinted
    /// panel, so the chip needs more weight than `dangerBg` carries.
    static let dangerChipBg = Color(hex: 0xB54334, opacity: 0.14)
    static let dangerPanelFill = Color(hex: 0xB54334, opacity: 0.08)
    static let dangerPanelBorder = Color(hex: 0xB54334, opacity: 0.20)

    // Screen background
    /// The flat base every screen sits on. Also the color of the seek bar's
    /// chapter ticks, which are cut out of the progress fill.
    static let screenBase = Color(hex: 0xEFECF9)
    /// The three out-of-frame glows that give the base its depth. See
    /// `ScreenBackground` for their sizes and positions.
    static let blobViolet = Color(hex: 0x7C6CDC, opacity: 0.42)
    static let blobBlue = Color(hex: 0x6096FF, opacity: 0.30)
    static let blobVioletLow = Color(hex: 0x7C6CDC, opacity: 0.28)
    /// The player runs two glows instead of three, both a shade quieter.
    static let blobVioletPlayer = Color(hex: 0x7C6CDC, opacity: 0.38)
    static let blobBluePlayer = Color(hex: 0x6096FF, opacity: 0.26)

    // Surface fills. Alpha is the whole idea: the glows have to read through
    // every card, so nothing on top of the background is opaque.
    /// Hero, past-episode and story cards. CSS backdrop-filter: none.
    static let cardFill = Color.white.opacity(0.62)
    /// The generation panel, settings groups, the expanded library row.
    /// The prototype washes these at .52 and puts blur(26px) saturate(1.8)
    /// behind them; that material is gone (see `Shape.glass`), and .52 alone
    /// reads thinner than the cards beside it. Raised to the cards' own wash so
    /// a panel and a card read as the same material, which is what the design
    /// intends even though it reaches it a different way.
    static let panelFill = Color.white.opacity(0.62)
    /// Transport buttons and the speed/chapters/transcript row, and the source
    /// cards inside a sheet. blur(18px) saturate(1.7) on the transport.
    static let controlFill = Color.white.opacity(0.55)
    /// Mini player and the player's source bar. blur(28px)/blur(26px).
    static let miniFill = Color.white.opacity(0.58)
    /// Search field, filter chips, icon tiles, the "Listen from here" pill.
    static let pillFill = Color.white.opacity(0.60)
    /// Statistic boxes and the onboarding length picker.
    static let tileFill = Color.white.opacity(0.70)
    /// Onboarding source tiles, which sit on the bare background with no card
    /// under them and so need more body.
    static let tileFillStrong = Color.white.opacity(0.80)

    /// CSS's `saturate()`, translated. The prototype's glass runs
    /// `backdrop-filter: blur(N) saturate(1.7-1.8)`, and the saturate is the
    /// half that carries the look: it pushes the background's lavender through
    /// the wash. SwiftUI's `.ultraThinMaterial` does the opposite and drains it
    /// — a backdrop of chroma 29 came back out of it at 16, and the settings
    /// screen's glass averaged chroma 5 against the prototype's 13, which is
    /// what "grey" meant. `.saturation` does reach what a material sampled,
    /// though, so the design's own filter can be had back. Not at 1.8: the
    /// material keeps only about 55% of the colour it samples, so 1.8 has to be
    /// divided by that to land in the same place. At 3, the same screen matches
    /// the prototype to a mean of 3/255 over 400 sampled patches, and needs no
    /// tint on top: the colour is the background's own, not a constant, so it
    /// still falls off with the glows the way the prototype's does.
    static let glassResaturate: Double = 3

    // Surface borders. White borders are the glass edge; ink borders are the
    // structural ones (rules, chip outlines, segmented controls).
    static let cardBorder = Color.white.opacity(0.85)
    static let panelBorder = Color.white.opacity(0.82)
    static let sheetBorder = Color.white.opacity(0.90)
    static let hairline = Color(hex: 0x1C1B22, opacity: 0.07)
    /// One step heavier than `hairline`: under the article's meta line, and
    /// between the columns of a statistic box.
    static let divider = Color(hex: 0x1C1B22, opacity: 0.08)
    /// Onboarding tiles and the statistic box.
    static let softBorder = Color(hex: 0x1C1B22, opacity: 0.09)
    /// Voice tiles, category chips, artwork rings on 40pt logos.
    static let tileBorder = Color(hex: 0x1C1B22, opacity: 0.10)
    /// Library filter chips, and the ring on the 32pt wordmark logo.
    static let filterBorder = Color(hex: 0x1C1B22, opacity: 0.12)
    /// Segmented controls, and the seek bar's unplayed track.
    static let controlBorder = Color(hex: 0x1C1B22, opacity: 0.14)
    /// The include/exclude pill on a story card.
    static let chipBorder = Color(hex: 0x1C1B22, opacity: 0.16)
    /// The onboarding page dots, when not the current page.
    static let dotIdle = Color(hex: 0x1C1B22, opacity: 0.18)
    /// The grabber at the top of a sheet.
    static let grabber = Color(hex: 0x1C1B22, opacity: 0.20)
    /// The dashed "How this episode was made" button.
    static let dashedBorder = Color(hex: 0x1C1B22, opacity: 0.22)
    /// Selected chapter row in the chapters sheet.
    static let rowSelected = Color(hex: 0x1C1B22, opacity: 0.05)

    // Sheets and overlays
    /// The sheet's own fill, over `scrim`. blur(36px) saturate(1.8).
    static let sheetFill = Color(hex: 0xFCFCFA, opacity: 0.66)
    static let scrim = Color(hex: 0x14121E, opacity: 0.35)

    // CSS `inset 0 1px 0 rgba(255,255,255,x)`: the one-pixel highlight along the
    // top edge of a glass surface. SwiftUI has no inset shadow, so screens draw
    // it as a hairline overlay.
    static let innerHighlight = Color.white.opacity(0.92)
    static let innerHighlightStrong = Color.white.opacity(0.95)
    static let innerHighlightSoft = Color.white.opacity(0.90)
    /// The same highlight over the accent gradient of a filled button.
    static let innerHighlightOnAccent = Color.white.opacity(0.30)
    /// The mini player and the player's source bar carry a brighter edge than a
    /// card does, `rgba(255,255,255,.88)`: they float over everything else.
    static let miniBorder = Color.white.opacity(0.88)

    // Tab bar (floating capsule, from v3.html's #dc-root markup)
    static let tabInactive = Color(hex: 0x8A87A0)
    /// .55 in the prototype, over blur(30px) saturate(1.8). Same reasoning as
    /// `panelFill`: with no material under it the bar needs the cards' wash to
    /// read as the same glass rather than as a thin film.
    static let tabBarFill = Color(hex: 0xFCFCFA, opacity: 0.62)
    static let tabBarBorder = Color.white.opacity(0.88)
    /// Same hue as every other ambient shadow; the tab bar just carries more
    /// opacity (0.2 vs a card's 0.13) to read as a floating pill, not a card.
    static let tabBarShadow = Color(hex: 0x3C3278, opacity: 0.2)

    // Pre-v3 tokens, kept because screens still reference them. The v3
    // prototype has no purple gradient card: its hero is `cardFill` over
    // `cardBorder`. Migrate call sites, then delete these.
    static let glassBorder = Color(hex: 0x6C5CC8, opacity: 0.28)
    static let glassShadow = Color(hex: 0x3C3278, opacity: 0.16)
    static let glassFill = LinearGradient(
        stops: [
            .init(color: Color(hex: 0x7C6CDC, opacity: 0.30), location: 0),
            .init(color: Color(hex: 0x7C6CDC, opacity: 0.12), location: 0.42),
            .init(color: Color.white.opacity(0.65), location: 1),
        ],
        startPoint: UnitPoint(x: 0.18, y: 0.12),
        endPoint: UnitPoint(x: 0.82, y: 0.88)
    )

    /// Filled call-to-action: linear-gradient(135deg, #7C6CDC, #5B4DBE). CSS
    /// 135deg points down and to the right.
    static let accentGradient = LinearGradient(
        colors: [accent, accentEnd],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// The airtime-budget bar in the backstage report, left to right.
    static let budgetGradient = LinearGradient(
        colors: [accent, accentSoft],
        startPoint: .leading,
        endPoint: .trailing
    )

    /// The glass edge, as a stroke. CSS gives a glass surface two things at
    /// once: a 1px border all the way round, and an `inset 0 1px 0` highlight
    /// on its top edge only. SwiftUI has no inset shadow, so one gradient
    /// stroke carries both — highlight at the top, the border's own alpha at
    /// the bottom. Pass the border the surface actually uses.
    static func glassEdge(_ border: Color, highlight: Color = innerHighlight) -> LinearGradient {
        LinearGradient(colors: [highlight, border], startPoint: .top, endPoint: .bottom)
    }

    /// Over `accentGradient`, where the surface has no border of its own and
    /// only the highlight exists.
    static let accentEdge = glassEdge(.clear, highlight: innerHighlightOnAccent)
}

// MARK: - Corner radii

/// Every radius in the prototype. Cards step 22 / 18 / 16, controls step
/// 14 / 13 / 12 / 11, and anything pill-shaped uses `pill`.
enum Radius {
    /// Hero card and past-episode cards.
    static let card: CGFloat = 22
    /// Blurred panels and the source cards inside a sheet.
    static let panel: CGFloat = 18
    /// Story cards, settings groups, the how-to-share rows.
    static let group: CGFloat = 16
    /// Onboarding hero artwork, and the top corners of a sheet.
    static let sheet: CGFloat = 24
    /// The player's 122pt artwork.
    static let artwork: CGFloat = 28
    /// Voice tiles, the statistic box, onboarding source tiles.
    static let tile: CGFloat = 14
    /// The dashed button and the expanded library row's detail panel.
    static let detail: CGFloat = 13
    /// Source icon tiles, chapter rows in the chapters sheet.
    static let icon: CGFloat = 12
    /// The dedupe banner.
    static let banner: CGFloat = 11
    /// App artwork at 32-40pt.
    static let logo: CGFloat = 10
    /// App artwork at 34pt, inside a past-episode card.
    static let logoSmall: CGFloat = 9
    /// Capsules. The prototype writes 100px everywhere; use `Capsule()` when
    /// the shape is the whole point.
    static let pill: CGFloat = 100
}

// MARK: - Blur

/// CSS backdrop-filter radii, for the surfaces that blur what is behind them.
/// All of them also saturate: 1.8, except `field` and `control` at 1.7.
/// Kept as the spec these surfaces were read from; `Glass` is what draws them.
enum Blur {
    static let field: CGFloat = 20
    static let control: CGFloat = 18
    static let panel: CGFloat = 26
    static let mini: CGFloat = 28
    static let tabBar: CGFloat = 30
    static let sheet: CGFloat = 36
}

// MARK: - Glass

/// Whether the prototype filters what is behind a surface.
///
/// This is the one thing a glass surface has to declare, because SwiftUI needs
/// a material to reach its backdrop at all and a material is not free: it also
/// desaturates, which is what made these surfaces read grey. `Palette
/// .glassResaturate` undoes that, so a filtered surface here is the prototype's
/// `blur() saturate()` and an unfiltered one is a plain translucent fill.
///
/// The blur itself is nearly free of effect over `ScreenBackground` alone — its
/// glows shift by under 1/255 across a 26pt window — but it matters where
/// content travels behind: the tab bar's inset region, the mini player, a sheet
/// over the player. It costs nothing to keep it in both cases, and the material
/// is the only handle on the backdrop the saturate needs.
enum Glass {
    /// No backdrop-filter in the prototype: the white wash and nothing else.
    /// Story and episode cards, filter chips, icon tiles.
    case none
    /// `backdrop-filter: blur(N) saturate(1.7-1.8)`. Panels, the search field,
    /// the tab bar, the player's controls and sheets.
    case filtered
}

extension Shape {
    /// One glass surface's backdrop: the white wash the token specifies and,
    /// where the design filters it, the material carrying the prototype's blur
    /// and saturate. Borders, clips and shadows stay at the call site — those
    /// differ per surface, this does not.
    func glass(_ fill: Color, _ treatment: Glass) -> some View {
        // No material, on purpose, and `treatment` currently changes nothing.
        //
        // A material was the only way to reach the backdrop and carry the
        // prototype's blur, but it desaturated what it sampled, which is what
        // made these surfaces read grey. Re-saturating it fixed that on a
        // simulator and did nothing on hardware: iOS renders every material as
        // a flat opaque fill when Reduce Transparency is on, and saturating an
        // opaque grey returns the same grey. The owner has that setting on, so
        // the material was costing the tint and delivering no blur at all.
        //
        // A plain wash over the real background keeps the lavender by
        // construction, in every accessibility state and on every compositor.
        // What it gives up is the blur where content genuinely scrolls behind a
        // surface -- measured at 95/255 under the tab bar on Library, and under
        // 5/255 everywhere the backdrop is only the screen gradient. `Glass`
        // stays because the call sites record which surfaces the prototype
        // filters; that is the list to revisit if the blur is ever wanted back
        // for people who have transparency enabled.
        self.fill(fill)
    }
}

// MARK: - Shadows

/// One CSS `box-shadow`, already converted: `radius` is half the CSS blur, and
/// every shadow in the prototype is straight down with no x offset.
struct Shadow {
    let color: Color
    let radius: CGFloat
    let y: CGFloat

    init(_ color: Color, radius: CGFloat, y: CGFloat) {
        self.color = color
        self.radius = radius
        self.y = y
    }
}

extension Palette {
    /// The violet-grey every ambient shadow is tinted with, rgb(60, 50, 120).
    static func ambient(_ opacity: Double) -> Color { Color(hex: 0x3C3278, opacity: opacity) }

    /// Cards, blurred panels, settings groups. `0 16px 40px rgba(60,50,120,.13)`
    static let cardShadow = Shadow(ambient(0.13), radius: 20, y: 16)
    /// The search field. `0 10px 26px rgba(60,50,120,.1)`
    static let fieldShadow = Shadow(ambient(0.10), radius: 13, y: 10)
    /// Source icon tiles. `0 6px 16px rgba(60,50,120,.1)`
    static let tileShadow = Shadow(ambient(0.10), radius: 8, y: 6)
    /// The "Listen from here" pill. `0 6px 16px rgba(60,50,120,.12)`
    static let pillShadow = Shadow(ambient(0.12), radius: 8, y: 6)
    /// Source cards inside a sheet. `0 12px 30px rgba(60,50,120,.1)`
    static let sheetCardShadow = Shadow(ambient(0.10), radius: 15, y: 12)
    /// Speed / chapters / transcript. `0 8px 20px rgba(60,50,120,.12)`
    static let controlShadow = Shadow(ambient(0.12), radius: 10, y: 8)
    /// The -15 / +15 transport buttons. `0 8px 20px rgba(60,50,120,.14)`
    static let transportShadow = Shadow(ambient(0.14), radius: 10, y: 8)
    /// The player's source bar. `0 14px 34px rgba(60,50,120,.16)`
    static let sourceBarShadow = Shadow(ambient(0.16), radius: 17, y: 14)
    /// The floating tab bar. `0 18px 44px rgba(60,50,120,.2)`
    static let tabBarDrop = Shadow(ambient(0.20), radius: 22, y: 18)
    /// The mini player, which floats above the tab bar and needs to separate
    /// from it. `0 18px 44px rgba(60,50,120,.24)`
    static let miniShadow = Shadow(ambient(0.24), radius: 22, y: 18)
    /// A sheet, cast upward. `0 -20px 60px rgba(60,50,120,.2)`
    static let sheetShadow = Shadow(ambient(0.20), radius: 30, y: -20)

    /// The dark Play button on the hero card. `0 8px 24px rgba(28,27,34,.22)`
    static let darkButtonShadow = Shadow(Color(hex: 0x1C1B22, opacity: 0.22), radius: 12, y: 8)
    /// The share-sheet pill in the how-to-share steps. `0 8px 18px rgba(28,27,34,.25)`
    static let darkPillShadow = Shadow(Color(hex: 0x1C1B22, opacity: 0.25), radius: 9, y: 8)
    /// The player's 68pt play button. `0 14px 34px rgba(28,27,34,.28)`
    static let playButtonShadow = Shadow(Color(hex: 0x1C1B22, opacity: 0.28), radius: 17, y: 14)
    /// The playing-bars badge pinned to the artwork's corner.
    /// `0 2px 8px rgba(28,27,34,.25)` — tight and dark, unlike the ambient
    /// violet drops: it reads as a chip lying on the cover.
    static let badgeShadow = Shadow(Color(hex: 0x1C1B22, opacity: 0.25), radius: 4, y: 2)

    /// The filled call-to-action. `0 12px 30px rgba(107,91,204,.4)`
    static let ctaShadow = Shadow(Color(hex: 0x6B5BCC, opacity: 0.40), radius: 15, y: 12)
    /// The same button in onboarding and the generation sheet, where it sits on
    /// the bare background. `0 10px 26px rgba(107,91,204,.35)`
    static let ctaShadowSoft = Shadow(Color(hex: 0x6B5BCC, opacity: 0.35), radius: 13, y: 10)

    /// App artwork at 104-122pt. `0 24px 60px rgba(50,42,110,.22)`, plus a 1pt
    /// ring of `divider`.
    static let artworkShadow = Shadow(Color(hex: 0x322A6E, opacity: 0.22), radius: 30, y: 24)
}

extension View {
    /// Applies a `Shadow` token.
    func dropShadow(_ shadow: Shadow) -> some View {
        self.shadow(color: shadow.color, radius: shadow.radius, x: 0, y: shadow.y)
    }
}

// MARK: - Backgrounds

/// The surface every screen sits on: a flat lilac base with three out-of-frame
/// radial glows. Not a linear gradient — the light has to come from corners, or
/// the glass cards on top have nothing to refract.
struct ScreenBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Palette.screenBase
                // 340pt at top -90, left -90.
                Blob(color: Palette.blobViolet, size: 340)
                    .offset(x: -90, y: -90)
                // 320pt at top 34%, right -120.
                Blob(color: Palette.blobBlue, size: 320)
                    .offset(x: geo.size.width - 200, y: geo.size.height * 0.34)
                // 300pt at bottom -70, left -60.
                Blob(color: Palette.blobVioletLow, size: 300)
                    .offset(x: -60, y: geo.size.height - 230)
            }
        }
        .ignoresSafeArea()
    }
}

/// The player's backdrop: same base, two glows instead of three, both quieter,
/// so the artwork stays the brightest thing on screen.
struct PlayerBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Palette.screenBase
                // 340pt at top -80, left -90.
                Blob(color: Palette.blobVioletPlayer, size: 340)
                    .offset(x: -90, y: -80)
                // 300pt at top 42%, right -110.
                Blob(color: Palette.blobBluePlayer, size: 300)
                    .offset(x: geo.size.width - 190, y: geo.size.height * 0.42)
            }
        }
        .ignoresSafeArea()
    }
}

/// One glow. CSS `radial-gradient(circle, c, transparent 70%)` on a square box
/// resolves to a circle that fades out almost exactly at the box's edge.
private struct Blob: View {
    let color: Color
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [color, color.opacity(0)],
                    center: .center,
                    startRadius: 0,
                    endRadius: size / 2
                )
            )
            .frame(width: size, height: size)
            .allowsHitTesting(false)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

// MARK: - Typography

enum Typo {
    /// The three faces bundled in Resources. The file names say Light/Regular/
    /// SemiBold but the PostScript names inside say Light/Medium/Bold, and
    /// PostScript is what Font.custom resolves.
    enum Weight {
        case light, regular, semibold

        var postScriptName: String {
            switch self {
            case .light: return "InterTight-Light"
            case .regular: return "InterTight-Medium"
            case .semibold: return "InterTight-Bold"
            }
        }

        var resourceName: String {
            switch self {
            case .light: return "InterTight-Light"
            case .regular: return "InterTight-Regular"
            case .semibold: return "InterTight-SemiBold"
            }
        }

        var systemFallback: Font.Weight {
            switch self {
            case .light: return .light
            case .regular: return .regular
            case .semibold: return .semibold
            }
        }
    }

    /// The app target's Info.plist is generated by XcodeGen and carries no
    /// UIAppFonts, so the faces are registered at runtime instead. Idempotent:
    /// re-registering an already registered file just fails harmlessly.
    @discardableResult
    static func registerFonts() -> Bool {
        for weight in [Weight.light, .regular, .semibold] {
            guard let url = Bundle.main.url(forResource: weight.resourceName, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        return UIFont(name: Weight.regular.postScriptName, size: 12) != nil
    }

    /// Resolved once, on first use, so previews and the app behave the same.
    static let interAvailable: Bool = registerFonts()

    /// A missing family must degrade to SF Pro, never render nothing.
    static func font(size: CGFloat, weight: Weight) -> Font {
        interAvailable
            ? .custom(weight.postScriptName, fixedSize: size)
            : .system(size: size, weight: weight.systemFallback)
    }
}

/// One text role: size, face, letter-spacing and line-height, as the markup sets them.
struct TypoStyle {
    let size: CGFloat
    let weight: Typo.Weight
    /// Letter-spacing in em, matching the CSS values (-.02em, +.12em...).
    let trackingEm: CGFloat
    /// CSS line-height multiple, 0 when the design leaves it to the font.
    let lineHeight: CGFloat
    let monospacedDigits: Bool

    init(
        size: CGFloat,
        weight: Typo.Weight,
        trackingEm: CGFloat = 0,
        lineHeight: CGFloat = 0,
        monospacedDigits: Bool = false
    ) {
        self.size = size
        self.weight = weight
        self.trackingEm = trackingEm
        self.lineHeight = lineHeight
        self.monospacedDigits = monospacedDigits
    }

    var font: Font {
        let base = Typo.font(size: size, weight: weight)
        return monospacedDigits ? base.monospacedDigit() : base
    }

    var tracking: CGFloat { size * trackingEm }

    /// SwiftUI's lineSpacing is the gap between lines, not the CSS line box: the
    /// font already carries roughly 1.2x of leading, so only the surplus is added.
    var lineSpacing: CGFloat { lineHeight > 0 ? max(0, size * (lineHeight - 1.2)) : 0 }

    /// Same role, digits locked to a fixed advance.
    var tabular: TypoStyle {
        TypoStyle(
            size: size,
            weight: weight,
            trackingEm: trackingEm,
            lineHeight: lineHeight,
            monospacedDigits: true
        )
    }
}

extension Typo {
    // Headings
    static let wordmark = TypoStyle(size: 22, weight: .semibold, trackingEm: -0.02)
    static let screenTitle = TypoStyle(size: 26, weight: .semibold, trackingEm: -0.02)
    static let articleTitle = TypoStyle(size: 27, weight: .semibold, trackingEm: -0.02, lineHeight: 1.15)
    /// Onboarding page headline.
    static let onboardingTitle = TypoStyle(size: 25, weight: .semibold, trackingEm: -0.02, lineHeight: 1.15)
    static let heroTitle = TypoStyle(size: 24, weight: .semibold, trackingEm: -0.02, lineHeight: 1.16)
    /// Generation sheet headline. Same size as the hero, looser leading.
    static let genTitle = TypoStyle(size: 24, weight: .semibold, trackingEm: -0.02, lineHeight: 1.2)
    static let playerTitle = TypoStyle(size: 23, weight: .semibold, trackingEm: -0.02, lineHeight: 1.18)
    /// Section heads, and the title bar of a sheet.
    static let sectionTitle = TypoStyle(size: 19, weight: .semibold, trackingEm: -0.01)
    static let chapterTitle = TypoStyle(size: 18, weight: .semibold, trackingEm: -0.01, lineHeight: 1.25)
    /// Past-episode cards in the Today carousel.
    static let episodeTitle = TypoStyle(size: 16.5, weight: .semibold, trackingEm: -0.01, lineHeight: 1.25)
    static let cardTitle = TypoStyle(size: 16, weight: .semibold, trackingEm: -0.01, lineHeight: 1.25)
    static let statNumber = TypoStyle(size: 22, weight: .semibold, monospacedDigits: true)

    // Labels
    static let overline = TypoStyle(size: 11, weight: .semibold, trackingEm: 0.12)
    /// The player's and the generation sheet's header, tracked one step wider.
    static let playerOverline = TypoStyle(size: 11, weight: .semibold, trackingEm: 0.13)
    /// Group heads inside a list or a report (TODAY, GROUNDING PASS, PIPELINE).
    static let sectionLabel = TypoStyle(size: 11, weight: .semibold, trackingEm: 0.10)
    static let chip = TypoStyle(size: 10, weight: .semibold, trackingEm: 0.05)
    /// Source-status chips in Library, and the verdict chips on a claim.
    static let statusChip = TypoStyle(size: 10.5, weight: .semibold, trackingEm: 0.04)
    static let cardTag = TypoStyle(size: 10.5, weight: .semibold, trackingEm: 0.08)
    /// The FROM label on the player's source bar.
    static let fromLabel = TypoStyle(size: 10, weight: .semibold, trackingEm: 0.10)
    static let sourcePub = TypoStyle(size: 11, weight: .semibold, trackingEm: 0.06)
    /// The publisher line on a source card inside a sheet.
    static let sheetSourcePub = TypoStyle(size: 11, weight: .semibold, trackingEm: 0.07)
    static let dateLabel = TypoStyle(size: 12, weight: .regular, trackingEm: 0.08)
    static let tabLabel = TypoStyle(size: 10, weight: .semibold, trackingEm: 0.04)
    /// Untracked 11pt semibold: pipeline chips, generation step numbers, the
    /// -15 / +15 transport labels.
    static let tagPill = TypoStyle(size: 11, weight: .semibold)

    // Rows and body
    static let readRowTitle = TypoStyle(size: 14.5, weight: .semibold)
    static let rowTitleStrong = TypoStyle(size: 14, weight: .semibold)
    static let rowTitle = TypoStyle(size: 14, weight: .regular)
    /// Source card title inside a sheet.
    static let sourceTitle = TypoStyle(size: 14, weight: .regular, lineHeight: 1.35)
    /// Settings row label, generation stage label, how-to-share step title.
    static let rowLabelStrong = TypoStyle(size: 13.5, weight: .semibold)
    static let rowLabel = TypoStyle(size: 13.5, weight: .regular)
    static let listTitle = TypoStyle(size: 13.5, weight: .regular, lineHeight: 1.35)
    /// The lead line of a sheet section, `13px/1.5`.
    static let sheetLead = TypoStyle(size: 13, weight: .regular, lineHeight: 1.5)
    /// The superseded half of a corrected sentence: lighter and a size down, so
    /// the fix reads first and the original reads as history.
    static let struckSentence = TypoStyle(size: 12, weight: .light, lineHeight: 1.45)
    /// Onboarding subtitle.
    static let onboardingBody = TypoStyle(size: 13.5, weight: .regular, lineHeight: 1.55)
    static let paragraph = TypoStyle(size: 15, weight: .light, lineHeight: 1.7)
    static let transcriptBody = TypoStyle(size: 15.5, weight: .light, lineHeight: 1.7)
    static let detail = TypoStyle(size: 12.5, weight: .regular, lineHeight: 1.45)
    static let meta = TypoStyle(size: 12, weight: .regular)
    static let metaSmall = TypoStyle(size: 11.5, weight: .regular)
    /// The same size, wrapped over several lines (card notes, footnotes).
    static let note = TypoStyle(size: 11.5, weight: .regular, lineHeight: 1.5)
    static let metaTiny = TypoStyle(size: 11, weight: .regular)
    /// Mini-player timecode, statistic captions.
    static let metaMicro = TypoStyle(size: 10.5, weight: .regular)
    /// The second line inside a voice tile.
    static let tileCaption = TypoStyle(size: 10, weight: .regular)

    // Controls
    /// The onboarding and generation-sheet call to action, a half point larger
    /// than the in-app buttons because it runs the full width.
    static let buttonHero = TypoStyle(size: 14.5, weight: .semibold)
    static let buttonLarge = TypoStyle(size: 14, weight: .semibold)
    static let buttonMedium = TypoStyle(size: 12.5, weight: .semibold)
    static let buttonSmall = TypoStyle(size: 12, weight: .semibold)
    static let pillButton = TypoStyle(size: 11.5, weight: .semibold)
    static let navButton = TypoStyle(size: 13, weight: .semibold)
    /// Text typed into the search field.
    static let field = TypoStyle(size: 13, weight: .regular)
    static let link = TypoStyle(size: 12.5, weight: .regular)
    /// The per-chapter source link under an article section.
    static let linkSmall = TypoStyle(size: 11.5, weight: .regular)
}

extension View {
    /// Applies a role: face, size, letter-spacing and line-height in one call.
    func typo(_ style: TypoStyle) -> some View {
        self
            .font(style.font)
            .tracking(style.tracking)
            .lineSpacing(style.lineSpacing)
    }
}
