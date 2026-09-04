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

// MARK: - Google

/// ASWebAuthenticationSession refuses to start without a presentation anchor,
/// and SwiftUI has no view controller to hand it. The key window of the
/// foreground scene is the honest answer.
private final class WebAuthAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

extension Auth {
    /// False when this build carries no client id, and the sign-in screen then
    /// does not offer Google at all.
    static var googleIsConfigured: Bool { !Config.googleClientId.isEmpty }

    /// Google sign-in without Google's SDK.
    ///
    /// The SDK would pull AppAuth, GTMAppAuth and GTMSessionFetcher into a
    /// project that has no dependencies whatsoever, and adding a Swift package
    /// means editing project.yml -- which XcodeGen must then regenerate, and
    /// XcodeGen is not installed on the machine this ships from. The system
    /// framework is already linked for Sign in with Apple and needs no URL type
    /// in Info.plist: ASWebAuthenticationSession intercepts its own callback.
    ///
    /// PKCE rather than a client secret: an iOS OAuth client is public, Google
    /// issues no secret for one, and the exchange is bound to a verifier this
    /// process generated and never sent anywhere else.
    ///
    /// THE NONCE IS THE TRAP. The server always compares the id_token's `nonce`
    /// claim against sha256hex(rawNonce). Apple echoes back the digest it was
    /// given; Google echoes back verbatim whatever it was given. Sending the
    /// digest -- the same thing the Apple path sends -- lands both providers on
    /// that one comparison, so the server needs no per-provider branch. Sending
    /// the raw nonce here would make every valid Google sign-in fail, and the
    /// failure would look like a rejected token rather than a client bug.
    @MainActor
    static func signInWithGoogle(rawNonce: String) async throws -> String {
        let clientId = Config.googleClientId
        guard !clientId.isEmpty else {
            throw AuthError.server(String(localized: "Google sign-in is not available in this build."))
        }

        // Google's iOS clients redirect to their own reversed client id. The
        // scheme is ours alone, so nothing else on the device can claim it.
        let scheme = clientId.split(separator: ".").reversed().joined(separator: ".")
        let redirect = "\(scheme):/oauth2redirect"

        let verifier = randomVerifier()
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))

        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")
        url?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "nonce", value: sha256Hex(rawNonce)),
        ]
        guard let authorize = url?.url else { throw AuthError.noToken }

        let callback = try await present(authorize, scheme: scheme)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        // Google reports a refusal in the callback rather than by failing it.
        if let error = items?.first(where: { $0.name == "error" })?.value {
            throw error == "access_denied" ? AuthError.cancelled : AuthError.server(error)
        }
        guard let code = items?.first(where: { $0.name == "code" })?.value else { throw AuthError.noToken }

        let idToken = try await redeem(code: code, verifier: verifier, clientId: clientId, redirect: redirect)
        return try await exchange(path: "/auth/google", token: idToken, nonce: rawNonce)
    }

    private static func present(_ url: URL, scheme: String) async throws -> URL {
        let anchor = WebAuthAnchor()
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            var session: ASWebAuthenticationSession?
            session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, _ in
                // Captured so ARC keeps both alive until this fires: a released
                // session cancels itself, and a released anchor takes the
                // presentation down with it. The closure dies here, so does the
                // cycle.
                _ = session
                _ = anchor
                if let callback {
                    continuation.resume(returning: callback)
                } else {
                    continuation.resume(throwing: AuthError.cancelled)
                }
            }
            session?.presentationContextProvider = anchor
            // Not ephemeral: a signed-in Safari makes this one tap, which is the
            // whole reason someone picks Google over typing an address.
            session?.prefersEphemeralWebBrowserSession = false
            if session?.start() != true { continuation.resume(throwing: AuthError.cancelled) }
        }
    }

    /// The authorization code is worth nothing on its own; this turns it into
    /// the id_token the server verifies. No client_secret: there is none for an
    /// iOS client, and PKCE is what proves the exchange belongs to us.
    private static func redeem(code: String, verifier: String, clientId: String, redirect: String) async throws -> String {
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_verifier", value: verifier),
        ]
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = form.percentEncodedQuery.map { Data($0.utf8) }
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            // Google answers { error, error_description }; showing its own words
            // beats a status code nobody can act on.
            struct Failure: Decodable { let error_description: String?; let error: String? }
            let body = try? JSONDecoder().decode(Failure.self, from: data)
            throw AuthError.server(body?.error_description ?? body?.error ?? "Google refused the exchange (\(code)).")
        }
        struct Reply: Decodable { let id_token: String? }
        guard let idToken = try JSONDecoder().decode(Reply.self, from: data).id_token, !idToken.isEmpty else {
            throw AuthError.noToken
        }
        return idToken
    }

    /// RFC 7636 wants 43-128 characters from the unreserved set.
    private static func randomVerifier() -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return String((0..<64).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
