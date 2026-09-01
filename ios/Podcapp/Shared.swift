import Foundation

// One source of truth for both targets. The app writes the credentials, the
// share extension reads them: they are separate processes, so the App Group
// container is what they actually share.
enum Config {
    static let appGroup = "group.com.louisguichard.podcapp"
    static let defaultBaseURL = "https://podcapp.vercel.app"

    // The App Group container only exists when the build carries its
    // entitlement. `UserDefaults(suiteName:)` is the WRONG probe for that: it
    // returns a defaults object either way (nil only for the main bundle id)
    // and silently swallows every write when the entitlement is missing, which
    // once made the token look saved while the app authenticated with an empty
    // one. containerURL is the honest probe, so a misprovisioned build falls
    // back to the app's own defaults and keeps working; only the share
    // extension truly needs the group.
    private static let groupWorks: Bool =
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil

    private static var store: UserDefaults {
        groupWorks ? (UserDefaults(suiteName: appGroup) ?? .standard) : .standard
    }

    /// False when the app and its share extension cannot see the same storage,
    /// which is the one failure the user has to be told about.
    static var sharesStorageWithExtension: Bool { groupWorks }

    static var baseURL: String {
        get { store.string(forKey: "baseURL") ?? defaultBaseURL }
        set { store.set(newValue, forKey: "baseURL") }
    }

    static var apiToken: String {
        get { store.string(forKey: "apiToken") ?? "" }
        set { store.set(newValue, forKey: "apiToken") }
    }

    static var isConfigured: Bool { !apiToken.isEmpty }

    // Shown once. Kept apart from isConfigured so a token cleared later does not
    // replay the whole story, it only asks for the token again.
    static var hasSeenOnboarding: Bool { store.bool(forKey: "sawOnboarding") }
    static func markOnboardingSeen() { store.set(true, forKey: "sawOnboarding") }
}

enum IngestError: LocalizedError {
    case notConfigured
    case badURL
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Ajoutez votre jeton dans l’app Podcapp avant de partager."
        case .badURL:
            return "Adresse du serveur invalide."
        case let .http(code, body):
            // The server always answers with {"error": "..."}; showing it beats a
            // status code the reader cannot act on.
            return code == 401 ? "Jeton refusé par le serveur." : "Erreur \(code). \(body)"
        }
    }
}

struct Ingest {
    // The payload mirrors the endpoint: { url } for a link, { text } otherwise.
    static func save(url: URL?, text: String?) async throws {
        guard Config.isConfigured else { throw IngestError.notConfigured }
        guard let endpoint = URL(string: Config.baseURL + "/ingest") else { throw IngestError.badURL }

        var body: [String: String] = [:]
        if let url { body["url"] = url.absoluteString }
        else if let text, !text.isEmpty { body["text"] = text }
        else { throw IngestError.badURL }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(Config.apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw IngestError.http(code, message ?? "")
        }
    }
}
