import Foundation
import UIKit
import UserNotifications

/// Notifications, from the permission prompt to the token the server needs.
///
/// Deliberately not asked on first launch. A prompt shown before anyone knows
/// what the app does is the one people refuse, and iOS never asks twice: a
/// refusal is permanent until someone walks into Settings. It is asked at the
/// only moment the answer is obviously yes -- when a briefing has just been
/// queued and the wait has begun.
@MainActor
enum Push {
    /// The token this device last registered, kept so the switch can revoke
    /// exactly it rather than guessing.
    private static let tokenKey = "pushToken"

    static var registeredToken: String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    /// The last thing that went wrong, kept so Settings can show it.
    ///
    /// Both failure paths were silent in the first version, and when no
    /// notification arrived there was no way to tell whether iOS had refused
    /// to register, or the upload to the server had failed, or the prompt had
    /// never been shown at all. A feature being brought up for the first time
    /// has to be able to say which step it died on.
    private(set) static var lastError: String? {
        get { UserDefaults.standard.string(forKey: "pushLastError") }
        set { UserDefaults.standard.set(newValue, forKey: "pushLastError") }
    }

    static func note(_ message: String?) { lastError = message }

    /// The user's own switch, in Settings. Separate from the system permission:
    /// iOS answers that question once, this one is ours and can be changed.
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "pushEnabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "pushEnabled") }
    }

    /// True once iOS has been asked, whatever the answer. Used to know whether
    /// asking again would show anything at all.
    static func authorization() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Asks, then registers. Returns false when the answer was no, so the caller
    /// can stay quiet rather than promising something that will not arrive.
    @discardableResult
    static func askAndRegister() async -> Bool {
        guard enabled else { return false }
        let center = UNUserNotificationCenter.current()
        let status = await authorization()
        if status == .denied { return false }
        if status == .notDetermined {
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound])
                if !granted {
                    note(String(localized: "Notifications refused."))
                    return false
                }
            } catch {
                note(error.localizedDescription)
                return false
            }
        }
        note(String(localized: "Waiting for the device token…"))
        UIApplication.shared.registerForRemoteNotifications()
        return true
    }

    /// Called from the app delegate with the raw token. Hex, because that is
    /// what APNs expects on the wire and what the server stores.
    static func received(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: tokenKey)
        Task {
            // A token can be rotated by iOS without warning, so this runs on
            // every launch; the server upserts rather than erroring.
            do {
                try await API.shared.registerPushToken(hex, environment: environment)
                note(nil)
            } catch {
                // Kept rather than swallowed: a token iOS granted but the server
                // never received looks exactly like a token that was refused.
                note(error.localizedDescription)
            }
        }
    }

    /// Which APNs host will be able to reach this build. A token minted by a
    /// development build is meaningless to the production host and the reverse,
    /// and the app is the only side that knows which one it is: the entitlement
    /// travels in the embedded provisioning profile, and TestFlight and the App
    /// Store both count as production.
    static var environment: String {
        #if DEBUG
            return "development"
        #else
            return "production"
        #endif
    }

    static func revoke() async {
        guard let token = registeredToken else { return }
        try? await API.shared.deletePushToken(token)
        UserDefaults.standard.removeObject(forKey: tokenKey)
    }
}

/// The one thing SwiftUI cannot do on its own: receive the device token. It
/// arrives through UIApplicationDelegate and nowhere else.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// One instance for both roles. The adaptor makes its own for the app
    /// delegate slot; the notification centre needs a strong reference of its
    /// own, and two different objects would answer two halves of one job.
    static let shared = PushDelegate()

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in Push.received(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // A simulator has no APNs and fails here every time, which is why this
        // was silent at first. But on a real phone it is the one place that
        // says the entitlement or the provisioning profile is wrong, and
        // swallowing it left "no notification arrived" with no explanation.
        Task { @MainActor in Push.note(error.localizedDescription) }
    }

    /// Shown even when the app is open: someone watching the generation sheet
    /// is exactly the person who wants to be told it finished.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
