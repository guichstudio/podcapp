import SwiftUI

@main
struct PodcappApp: App {
    init() {
        // UIAppFonts in Info.plist already loads the three faces. This call is
        // idempotent and is what settles Typo.interAvailable, which decides
        // whether text draws in Inter Tight or falls back to SF Pro.
        Typo.registerFonts()
        // Four files, 15 KB: loading them now means the first feedback sound is
        // on time rather than a beat late.
        Feedback.warmUp()
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
                // The phone's language is the product's language: the interface
                // follows it on its own, and this is what makes the episodes
                // follow it too.
                .task { await API.shared.reportLanguageIfChanged() }
                .onReceive(NotificationCenter.default.publisher(for: .podcappSignedOut)) { _ in
                    withAnimation { connected = false }
                }
                .onReceive(NotificationCenter.default.publisher(for: .podcappReplayOnboarding)) { _ in
                    withAnimation { connected = false }
                }
        } else {
            OnboardingView(onDone: { connected = true })
                .transition(.opacity)
        }
    }
}
