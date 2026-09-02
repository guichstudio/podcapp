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
}
