import Foundation

// One source of truth for both targets. The app writes the credentials, the
// share extension reads them: they are separate processes, so the App Group
// container is what they actually share.
enum Config {
    static let appGroup = "group.com.louisguichard.podcapp"
    static let defaultBaseURL = "https://podcapp.vercel.app"

    private static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static var baseURL: String {
        get { store?.string(forKey: "baseURL") ?? defaultBaseURL }
        set { store?.set(newValue, forKey: "baseURL") }
    }

    static var apiToken: String {
        get { store?.string(forKey: "apiToken") ?? "" }
        set { store?.set(newValue, forKey: "apiToken") }
    }

    static var isConfigured: Bool { !apiToken.isEmpty }
}

enum IngestError: LocalizedError {
    case notConfigured
    case badURL
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Ajoutez votre jeton dans l'app Briefing avant de partager."
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
