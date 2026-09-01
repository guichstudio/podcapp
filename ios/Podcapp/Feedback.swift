import AVFoundation
import UIKit

/// Every haptic and every sound the app makes, in one place, so a screen never
/// holds a feedback generator and both can be switched off in Réglages.
///
/// The rule that shapes this: taps are felt, not heard. Only four moments make
/// a sound — something saved, something refused, a generation leaving, and a
/// chapter turning under the narration. Everything else is haptic only, because
/// an app you listen to cannot afford to chirp over itself.
enum Feedback {
    // MARK: - Haptics

    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()
    private static let notice = UINotificationFeedbackGenerator()

    /// A choice among several: a tab, a segment, a page of the onboarding.
    static func select() {
        guard Config.hapticsEnabled else { return }
        selection.selectionChanged()
        selection.prepare()
    }

    /// A button that did something small.
    static func tap() {
        guard Config.hapticsEnabled else { return }
        light.impactOccurred(intensity: 0.7)
        light.prepare()
    }

    /// The narration starting or stopping under your thumb. Starting hits a
    /// little harder than stopping, which is how a physical transport feels.
    static func play() {
        guard Config.hapticsEnabled else { return }
        soft.impactOccurred(intensity: 0.85)
        soft.prepare()
    }

    static func pause() {
        guard Config.hapticsEnabled else { return }
        soft.impactOccurred(intensity: 0.55)
        soft.prepare()
    }

    /// A chapter turning while you listen. The one piece of feedback the app
    /// gives without being touched, so it is the quietest of the set.
    static func chapterTurned() {
        if Config.hapticsEnabled {
            rigid.impactOccurred(intensity: 0.45)
            rigid.prepare()
        }
        play(sound: "tick")
    }

    /// Saved, connected, done. `sound` is false in the share extension: it sits
    /// on top of somebody else's app and has no business making noise there.
    static func saved(sound: Bool = true) {
        if Config.hapticsEnabled { notice.notificationOccurred(.success) }
        if sound { play(sound: "up") }
        notice.prepare()
    }

    static func refused(sound: Bool = true) {
        if Config.hapticsEnabled { notice.notificationOccurred(.error) }
        if sound { play(sound: "down") }
        notice.prepare()
    }

    /// A generation handed to the cloud: ten minutes of work leaving the phone.
    static func launched() {
        if Config.hapticsEnabled {
            medium.impactOccurred()
            medium.prepare()
        }
        play(sound: "launch")
    }

    // MARK: - Sounds

    private static var players: [String: AVAudioPlayer] = [:]

    /// Loads the four files up front. They total 15 KB, and a feedback sound
    /// that arrives late is worse than none.
    static func warmUp() {
        for name in ["tick", "up", "down", "launch"] { _ = player(named: name) }
        selection.prepare()
        soft.prepare()
        notice.prepare()
    }

    private static func play(sound name: String) {
        guard Config.soundEnabled, let player = player(named: name) else { return }
        claimSessionIfFree()
        player.currentTime = 0
        player.play()
    }

    private static func player(named name: String) -> AVAudioPlayer? {
        if let cached = players[name] { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "m4a"),
              let made = try? AVAudioPlayer(contentsOf: url)
        else { return nil }
        made.prepareToPlay()
        players[name] = made
        return made
    }

    /// Never takes the session away from the briefing: .playback is what the
    /// player sets so an episode keeps going with the screen off, and changing
    /// it mid-episode would cut the audio. The rest of the time .ambient is the
    /// polite category — it mixes with whatever the phone is already playing,
    /// and it obeys the ring/silent switch, which a UI sound must.
    private static func claimSessionIfFree() {
        let session = AVAudioSession.sharedInstance()
        guard session.category != .playback else { return }
        try? session.setCategory(.ambient, options: [.mixWithOthers])
    }
}
