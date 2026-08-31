import SwiftUI

@main
struct PodcappApp: App {
    init() {
        // UIAppFonts in Info.plist already loads the three faces. This call is
        // idempotent and is what settles Typo.interAvailable, which decides
        // whether text draws in Inter Tight or falls back to SF Pro.
        Typo.registerFonts()
    }

    var body: some Scene {
        WindowGroup { Entry() }
    }
}

// The onboarding runs once, and again whenever there is no token to work with:
// an app that cannot reach its server has nothing to show, so asking is the only
// honest first screen.
private struct Entry: View {
    @State private var connected = Config.isConfigured && Config.hasSeenOnboarding

    var body: some View {
        if connected {
            RootView()
        } else {
            OnboardingView(onDone: { connected = true })
                .transition(.opacity)
        }
    }
}
