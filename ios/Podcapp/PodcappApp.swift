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
        WindowGroup { RootView() }
    }
}
