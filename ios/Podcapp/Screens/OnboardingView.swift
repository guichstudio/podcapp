import SwiftUI

// The App Store onboarding from ios/design/onboarding-layout.html, as the first
// run of the app. Five screens tell what the product does, the sixth connects it.
//
// The design's sixth screen offers "Continuer avec Apple" and "Continuer avec
// Google". Neither exists: the product authenticates with a per-user token that
// is issued by hand, and Sign in with Apple would need a paid developer account
// and a backend that does not exist. Rather than ship two buttons that cannot
// work, that screen keeps its layout and asks for the token, which is what
// actually connects the app.

struct OnboardingView: View {
    let onDone: () -> Void

    @State private var page = 0
    @State private var token = ""
    @State private var status: ConnectStatus = .idle
    @FocusState private var tokenFocused: Bool

    enum ConnectStatus: Equatable { case idle, checking, failed(String) }

    private static let pages: [OnboardingPage] = [
        .init(
            eyebrow: "01",
            title: "Trop à lire ?",
            accent: "Écoutez.",
            body: "Vos articles, vidéos et newsletters deviennent un briefing audio quotidien, dans votre app de podcast ou ici.",
            glyph: "headphones"
        ),
        .init(
            eyebrow: "02",
            title: "Un geste.",
            accent: "C’est capturé.",
            body: "Touchez Partager depuis n’importe quelle app, choisissez Podcapp. C’est tout, vous restez où vous étiez.",
            glyph: "square.and.arrow.up"
        ),
        .init(
            eyebrow: "03",
            title: "Tout y passe.",
            accent: "Vraiment tout.",
            body: "Article, vidéo, lien, thread. Les vidéos sont transcrites automatiquement, les newsletters arrivent par transfert.",
            glyph: "tray.full"
        ),
        .init(
            eyebrow: "04",
            title: "Construit,",
            accent: "pas lu à voix haute.",
            body: "Chaque phrase est confrontée à sa source avant diffusion. Celles qui ne tiennent pas sont réécrites ou coupées, et le rapport reste consultable.",
            glyph: "checkmark.seal"
        ),
        .init(
            eyebrow: "05",
            title: "Et si vous préférez,",
            accent: "lisez.",
            body: "Chaque briefing existe aussi en article, chapitre par chapitre, avec ses sources. Écoutez à partir de n’importe quel passage.",
            glyph: "text.alignleft"
        ),
    ]

    var body: some View {
        ZStack {
            OnboardingBackground()
            VStack(spacing: 0) {
                header
                TabView(selection: $page) {
                    ForEach(Array(Self.pages.enumerated()), id: \.offset) { index, page in
                        OnboardingPageView(page: page)
                            .tag(index)
                    }
                    connectPage.tag(Self.pages.count)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                dots
                footer
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 28)
        }
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
            ForEach(0...Self.pages.count, id: \.self) { i in
                Capsule()
                    .fill(i == page ? Palette.accentDeep : Palette.ink.opacity(0.16))
                    .frame(width: i == page ? 18 : 6, height: 6)
                    .animation(.snappy(duration: 0.25), value: page)
            }
        }
        .padding(.bottom, 22)
    }

    @ViewBuilder private var footer: some View {
        if page < Self.pages.count {
            HStack(spacing: 12) {
                Button("Passer") { page = Self.pages.count }
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
        }
    }

    private var connectPage: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 12)
            Text("On commence ?")
                .typo(TypoStyle(size: 33, weight: .semibold, trackingEm: -0.02, lineHeight: 1.08))
                .foregroundStyle(Palette.ink)
            Text("2 secondes.")
                .typo(TypoStyle(size: 33, weight: .semibold, trackingEm: -0.02, lineHeight: 1.08))
                .foregroundStyle(Palette.accentDeep)
            Text("Votre radio quotidienne, sourcée par vous, vérifiée par nous.")
                .typo(TypoStyle(size: 15, weight: .regular, lineHeight: 1.5))
                .foregroundStyle(Palette.body)
                .padding(.top, 14)

            // The design's OAuth buttons are replaced by the only credential the
            // product actually has. Saying so beats a button that cannot work.
            Text("Collez le jeton que vous a donné votre serveur.")
                .typo(Typo.metaSmall)
                .foregroundStyle(Palette.muted2)
                .padding(.top, 26)

            SecureField("Jeton d’API", text: $token)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($tokenFocused)
                .typo(TypoStyle(size: 15, weight: .regular))
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.8)))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color(hex: 0x1C1B22, opacity: 0.1)))
                .padding(.top, 8)

            Button {
                Task { await connect() }
            } label: {
                HStack(spacing: 8) {
                    if status == .checking { ProgressView().tint(.white) }
                    Text(status == .checking ? "Connexion" : "Continuer")
                        .typo(Typo.buttonLarge)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Capsule().fill(token.isEmpty ? Palette.ink.opacity(0.35) : Palette.ink))
            }
            .buttonStyle(.plain)
            .disabled(token.isEmpty || status == .checking)
            .padding(.top, 14)

            if case let .failed(message) = status {
                Text(message)
                    .typo(Typo.metaSmall)
                    .foregroundStyle(Palette.danger)
                    .padding(.top, 10)
            }

            Text("Aucun mot de passe · flux RSS privé inclus")
                .typo(Typo.metaTiny)
                .foregroundStyle(Palette.muted2)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)

            Spacer(minLength: 12)
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

private struct OnboardingPage {
    let eyebrow: String
    let title: String
    let accent: String
    let body: String
    let glyph: String
}

private struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            Image(systemName: page.glyph)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Palette.accentDeep)
                .padding(.bottom, 28)
            Text(page.title)
                .typo(TypoStyle(size: 33, weight: .semibold, trackingEm: -0.02, lineHeight: 1.08))
                .foregroundStyle(Palette.ink)
            Text(page.accent)
                .typo(TypoStyle(size: 33, weight: .semibold, trackingEm: -0.02, lineHeight: 1.08))
                .foregroundStyle(Palette.accentDeep)
            Text(page.body)
                .typo(TypoStyle(size: 15, weight: .regular, lineHeight: 1.55))
                .foregroundStyle(Palette.body)
                .padding(.top, 16)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

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
