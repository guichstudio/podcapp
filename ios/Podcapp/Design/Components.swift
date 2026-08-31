import SwiftUI

// The pieces the markup repeats across screens. Anything used once stays in the
// screen that uses it.

/// Pill badge on a source, an episode row or a grounding claim.
struct StatusChip: View {
    enum Kind {
        case success, neutral, warning, danger, aired

        var foreground: Color {
            switch self {
            case .success: return Palette.success
            case .neutral: return Palette.neutralChip
            case .warning: return Palette.warning
            case .danger: return Palette.danger
            case .aired: return Palette.airedChip
            }
        }

        var background: Color {
            switch self {
            case .success: return Palette.successBg
            case .neutral: return Palette.neutralChipBg
            case .warning: return Palette.warningBg
            case .danger: return Palette.dangerBg
            case .aired: return Palette.airedChipBg
            }
        }
    }

    let label: String
    let kind: Kind

    var body: some View {
        Text(label)
            .textCase(.uppercase)
            .typo(Typo.chip)
            .foregroundStyle(kind.foreground)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(kind.background, in: Capsule())
    }
}

/// The letter-spaced uppercase label that sits above a section.
struct Overline: View {
    let text: String
    var color: Color = Palette.muted2

    var body: some View {
        Text(text)
            .textCase(.uppercase)
            .typo(Typo.overline)
            .foregroundStyle(color)
    }
}

/// The hero treatment: violet gradient, hairline border, deep soft shadow.
struct GlassCard<Content: View>: View {
    @ViewBuilder var content: Content

    private let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(EdgeInsets(top: 20, leading: 20, bottom: 18, trailing: 20))
            .background(Palette.glassFill, in: shape)
            .overlay(shape.strokeBorder(Palette.glassBorder, lineWidth: 1))
            .shadow(color: Palette.glassShadow, radius: 30, y: 24)
    }
}

/// The translucent white card behind rows, lists and settings groups.
struct PlainCard<Content: View>: View {
    var cornerRadius: CGFloat = 16
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: .continuous) }

    var body: some View {
        content
            .padding(padding)
            .background(Palette.cardFill, in: shape)
            .overlay(shape.strokeBorder(Palette.cardBorder, lineWidth: 1))
    }
}

extension View {
    /// Durations and timings must not jitter as their digits change.
    func tabularNumerals() -> some View {
        monospacedDigit()
    }
}

// MARK: - Previews

#Preview("StatusChip") {
    VStack(alignment: .leading, spacing: 10) {
        StatusChip(label: "Prêt", kind: .success)
        StatusChip(label: "Analysé", kind: .neutral)
        StatusChip(label: "Extraction", kind: .warning)
        StatusChip(label: "Échec", kind: .danger)
        StatusChip(label: "Diffusé", kind: .aired)
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ScreenBackground())
}

#Preview("Overline") {
    VStack(alignment: .leading, spacing: 14) {
        Overline(text: "Dernier briefing · ven. 28 août", color: Palette.accentDeep)
        Overline(text: "Aujourd'hui")
        Overline(text: "Budget d'antenne")
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ScreenBackground())
}

#Preview("GlassCard") {
    GlassCard {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Overline(text: "Dernier briefing · ven. 28 août", color: Palette.accentDeep)
                Spacer()
                Text("10:05")
                    .typo(Typo.overline)
                    .foregroundStyle(Palette.accentDeep)
                    .tabularNumerals()
            }
            Text("Le cafard de Wall Street, Claude passe des ordres, les douze fins de l'IA.")
                .typo(Typo.heroTitle)
                .foregroundStyle(Palette.ink)
            Text("✓ 42 phrases vérifiées · 4 sources · 1 écartée")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.accentMuted)
        }
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ScreenBackground())
}

#Preview("PlainCard") {
    VStack(spacing: 16) {
        PlainCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Contagion du crédit privé")
                    .typo(Typo.cardTitle)
                    .foregroundStyle(Palette.ink)
                Text("2 sources · 1 chapitre")
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        PlainCard(cornerRadius: 18, padding: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Briefing de lundi")
                    .typo(Typo.rowTitleStrong)
                    .foregroundStyle(Palette.ink)
                Text("7 prêts · ~15 min")
                    .typo(Typo.meta)
                    .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ScreenBackground())
}

#Preview("Tabular numerals") {
    VStack(alignment: .trailing, spacing: 6) {
        Text("2:30").typo(Typo.meta).tabularNumerals()
        Text("1:11").typo(Typo.meta).tabularNumerals()
        Text("14:36").typo(Typo.meta).tabularNumerals()
    }
    .foregroundStyle(Palette.muted)
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ScreenBackground())
}
