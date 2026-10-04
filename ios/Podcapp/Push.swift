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

    /// Re-registers on every launch and every return to the foreground, once
    /// permission exists. The token is otherwise sent only at the moment the
    /// prompt is answered, and that was the whole failure of the first builds:
    /// on 2026-10-04 the server held ZERO tokens for ten accounts, because an
    /// upload that failed once was never tried again and anyone who never
    /// opened the generation sheet was never asked. iOS hands back the same
    /// token cheaply and the server upserts it, so repeating this costs nothing.
    ///
    /// It also ASKS when iOS never has (b37). b36 waited for an "obvious"
    /// moment -- a generation started, a first support message -- and measured
    /// on Louis's own phone the same day, that moment never came: he opened the
    /// chat without writing, and the feedback request had nobody to reach. This
    /// only runs inside the signed-in shell, after the onboarding has explained
    /// what the app does, so it is not the cold first-launch prompt the comment
    /// at the top of this file rightly avoids.
    static func registerIfAuthorized() async {
        guard enabled else { return }
        switch await authorization() {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined:
            await askAndRegister()
        default:
            break
        }
    }

    /// Set when a support notification is tapped before the shell exists -- a
    /// cold launch from the notification -- so RootView opens the chat once it
    /// appears instead of missing a NotificationCenter post made too early.
    static var pendingSupport = false

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
    /// is exactly the person who wants to be told it finished. A support reply
    /// also refreshes the badge, since the banner alone would leave it stale.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if notification.request.content.userInfo["support"] != nil {
            await SupportInbox.shared.refresh()
        }
        return [.banner, .sound]
    }

    /// A tapped support notification opens the chat.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.notification.request.content.userInfo["support"] != nil else { return }
        await MainActor.run {
            Push.pendingSupport = true
            NotificationCenter.default.post(name: .podcappOpenSupport, object: nil)
        }
    }
}

extension Notification.Name {
    /// Opens the support chat: from the Settings row, or from a tapped
    /// notification. RootView owns the sheet, so there is one way in.
    static let podcappOpenSupport = Notification.Name("podcapp.openSupport")
}
