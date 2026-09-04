import Foundation

// One source of truth for both targets. The app writes the credentials, the
// share extension reads them: they are separate processes, so the App Group
// container is what they actually share.
enum Config {
    static let appGroup = "group.com.louisguichard.podcapp"
    static let defaultBaseURL = "https://podcapp.vercel.app"

    /// The public site, which serves the privacy policy and the terms under the
    /// product's own domain. Fixed rather than derived from `baseURL`: those two
    /// documents belong to the product, not to whichever server instance a build
    /// talks to, and their URL is read by people and published on the App Store
    /// listing. `pnpm site:legal` regenerates them from `src/legal/`, so the API
    /// and the site cannot drift apart.
    static let siteURL = "https://podcapp.fr"

    /// The Google OAuth client id for this app, from Google Cloud Console
    /// (credential type iOS, bundle id com.louisguichard.podcapp). Empty means
    /// the build was not configured for Google, and the sign-in screen then
    /// simply does not offer it -- a button that cannot work is worse than an
    /// absent one, and this project does not ship inert UI.
    ///
    /// It is not a secret: an iOS OAuth client is public by design, Google
    /// issues no secret for it, and the code exchange is protected by PKCE
    /// instead. The server must carry the SAME value in GOOGLE_CLIENT_ID,
    /// because that is the audience it checks the id_token against.
    static let googleClientId = ""

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

    // Le jeton de session emis par /auth/apple ou /auth/google. Il occupe la
    // place ou vivait le jeton d'API : l'extension de partage lit cette meme
    // case et n'a donc pas eu a changer.
    static var sessionToken: String {
        get { store.string(forKey: "apiToken") ?? "" }
        set { store.set(newValue, forKey: "apiToken") }
    }

    static var isConfigured: Bool { !sessionToken.isEmpty }

    /// The language last accepted by the server, so the app does not repeat
    /// itself on every launch.
    static var reportedLanguage: String? {
        get { store.string(forKey: "reportedLanguage") }
        set { store.set(newValue, forKey: "reportedLanguage") }
    }

    // object(forKey:), not bool(forKey:): an absent key reads as false there,
    // and both of these are on until someone turns them off.
    static var hapticsEnabled: Bool {
        get { store.object(forKey: "haptics") as? Bool ?? true }
        set { store.set(newValue, forKey: "haptics") }
    }

    static var soundEnabled: Bool {
        get { store.object(forKey: "sounds") as? Bool ?? true }
        set { store.set(newValue, forKey: "sounds") }
    }

    // Shown once. Kept apart from isConfigured so a token cleared later does not
    // replay the whole story, it only asks for the token again.
    static var hasSeenOnboarding: Bool { store.bool(forKey: "sawOnboarding") }
    static func markOnboardingSeen() { store.set(true, forKey: "sawOnboarding") }

    /// Clears the session locally, whichever side decided it should end: the
    /// API layer discovering a 401 on a call that was supposed to be
    /// authenticated (revoked server-side, an admin action, the account
    /// itself gone -- the token is already dead, so there is nothing left to
    /// tell the server), or a caller that has already dealt with the server
    /// side itself (Auth.signOut() revokes the session first, then calls this
    /// unconditionally -- see it for why "unconditionally" is the point).
    /// Clears what the share extension reads too -- that is the whole point
    /// -- and tells the app shell to fall back to onboarding. Never call this
    /// directly from a sign-out button: that is Auth.signOut(), which also
    /// tells the server so the session's row does not stay live forever.
    static func endSession() {
        sessionToken = ""
        reportedLanguage = nil
        NotificationCenter.default.post(name: .podcappSignedOut, object: nil)
    }
}

/// The locale of the language the app actually resolved to, which is not
/// Locale.current: a phone in English with a French region would otherwise mix
/// an English interface with French month names.
enum AppLocale {
    static let current = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "en")

    /// What the pipeline is told to write and speak in: the two letters the
    /// server stores in users.output_language.
    static var code: String { String(current.identifier.prefix(2)) }

    static var isEnglish: Bool { code == "en" }
}

extension Notification.Name {
    /// Posted once the account is deleted, so the shell drops back to onboarding.
    static let podcappSignedOut = Notification.Name("podcapp.signedOut")
    /// Posted from Réglages: the shell shows the onboarding again, token kept.
    static let podcappReplayOnboarding = Notification.Name("podcapp.replayOnboarding")
}

enum IngestError: LocalizedError {
    case notConfigured
    case badURL
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return String(localized: "Sign in to the Podcapp app before sharing.")
        case .badURL:
            return String(localized: "Invalid server address.")
        case let .http(code, body):
            // The server always answers with {"error": "..."}; showing it beats a
            // status code the reader cannot act on.
            return code == 401
                ? String(localized: "Token refused by the server.")
                : String(localized: "Error \(code). \(body)")
        }
    }
}

struct Ingest {
    /// What the server says once the capture has landed: how many links are
    /// behind the next episode, and how many it needs. Both are optional
    /// because an older deployment does not send them, and the sheet then
    /// simply shows the save without the count.
    struct Receipt {
        let available: Int?
        let minimum: Int?
    }

    // The payload mirrors the endpoint: { url } for a link, { text } otherwise.
    @discardableResult
    static func save(url: URL?, text: String?) async throws -> Receipt {
        guard Config.isConfigured else { throw IngestError.notConfigured }
        guard let endpoint = URL(string: Config.baseURL + "/ingest") else { throw IngestError.badURL }

        var body: [String: String] = [:]
        if let url { body["url"] = url.absoluteString }
        else if let text, !text.isEmpty { body["text"] = text }
        else { throw IngestError.badURL }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(Config.sessionToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard (200..<300).contains(code) else {
            throw IngestError.http(code, json?["error"] as? String ?? "")
        }
        return Receipt(available: json?["available"] as? Int, minimum: json?["minimum"] as? Int)
    }
}
