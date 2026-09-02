import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

enum AuthError: LocalizedError {
    case cancelled
    case noToken
    case server(String)

    var errorDescription: String? {
        switch self {
        case .cancelled: return String(localized: "Sign-in cancelled.")
        case .noToken: return String(localized: "The provider returned no identity token.")
        case .server(let message): return message
        }
    }
}

enum Auth {
    /// L'alea que le serveur re-empreinte pour refuser un jeton rejoue.
    static func makeNonce() -> String {
        Data((0..<32).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
    }

    static func sha256Hex(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Le libelle affiche dans « Appareils connectes ». iOS 16+ renvoie un nom
    /// generique sans entitlement dedie : on s'en contente plutot que de
    /// demander cette autorisation pour un confort mineur.
    static var deviceName: String { UIDevice.current.name }

    /// Echange un jeton de fournisseur contre un jeton de session, et le range.
    static func exchange(path: String, token: String, nonce: String) async throws -> String {
        struct Body: Encodable { let token: String; let nonce: String; let device_name: String }
        struct Reply: Decodable { let token: String }
        let session = try await API.shared.postUnauthenticated(
            path: path,
            body: Body(token: token, nonce: nonce, device_name: deviceName),
            as: Reply.self
        )
        Config.sessionToken = session.token
        return session.token
    }

    /// App Review's way in without a personal Apple ID: /auth/password takes
    /// the credentials straight, no nonce dance -- there is no provider round
    /// trip to defend against replay here. Same postUnauthenticated path as
    /// `exchange`, so a sign-in failure surfaces the same way on both forms.
    static func signInWithPassword(email: String, password: String) async throws -> String {
        struct Body: Encodable { let email: String; let password: String; let device_name: String }
        struct Reply: Decodable { let token: String }
        let session = try await API.shared.postUnauthenticated(
            path: "/auth/password",
            body: Body(email: email, password: password, device_name: deviceName),
            as: Reply.self
        )
        Config.sessionToken = session.token
        return session.token
    }

    /// The one way a sign-out button should end this device's own session:
    /// revoke it server-side, then clear it locally regardless of whether
    /// that call succeeded. The order matters for what it does NOT do wrong --
    /// clearing locally first would throw away the very token the revoke call
    /// needs -- but the outcome does not depend on the network call landing:
    /// offline, timed out, or the session already gone all end the same way,
    /// signed out on this device. Config.endSession() alone (still used
    /// as-is for the 401 auto-sign-out in API.swift's `perform`, which has
    /// already learned the token is dead) never told the server anything, so
    /// a revoked_at row would sit NULL forever and a token recovered from a
    /// backup would keep working.
    static func signOut() async {
        try? await API.shared.revokeCurrentSession()
        await MainActor.run { Config.endSession() }
    }
}
