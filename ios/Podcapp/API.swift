import Foundation

// Client of the same function that receives captures: reads, plus the one
// write this app makes (queueing a briefing). Property names match the JSON
// keys exactly, which is why there is not a single CodingKeys table here: the
// payloads in api/index.ts are camelCase on purpose, and the write endpoints
// speak snake_case (source_id, episode_id, target_min) on purpose too.

struct EpisodeSummary: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let status: String
    let createdAt: Date
    let actualSec: Int?
    let audioBytes: Int?
    let chapters: [EpisodeChapterSummary]

    // A queued or failed episode has no mp3 and the server sends null rather
    // than a link that would 404 in the player.
    let audioUrl: String?
    var audioURL: URL? { audioUrl.flatMap(URL.init(string:)) }
}

struct EpisodeChapterSummary: Decodable, Sendable {
    let title: String
    let sourceCount: Int
}

struct EpisodeDetail: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let status: String
    let createdAt: Date
    let actualSec: Int?
    let targetSec: Int?
    let audioBytes: Int?
    let chapters: [EpisodeChapter]

    // The plan, not the result: what the outline budgeted and what it refused.
    let budget: [BudgetLine]
    let discarded: [String]
    let verification: Verification?
    let usd: Double?

    let audioUrl: String?
    var audioURL: URL? { audioUrl.flatMap(URL.init(string:)) }
}

struct EpisodeChapter: Decodable, Sendable {
    let title: String
    let text: String
    // Every id the chapter cites. `sources` can be shorter: a cited source that
    // no longer exists is dropped rather than faked.
    let sourceIds: [String]
    let sources: [ChapterSource]
    // Every checkable sentence of this chapter, with the verdict it got before
    // the episode aired. An intro carries no external claim, so empty is normal.
    let grounding: [GroundingEntry]

    var correctedCount: Int { grounding.filter { $0.action == "fixed" }.count }
}

// What the editorial stage decided before writing, and what the run cost. The
// backstage view is the debug trail of ARCHITECTURE section 9 made readable.
struct BudgetLine: Decodable, Sendable, Identifiable {
    let title: String
    let airtimeSec: Int
    var id: String { title }
}

struct Verification: Decodable, Sendable {
    let checked: Int
    let corrected: Int
    let dropped: Int
}

struct GroundingEntry: Decodable, Sendable, Identifiable {
    let sentence: String
    let supported: Bool
    let action: String
    let fix: String?

    var id: String { sentence }
    // 'kept' means the grounder supported the sentence as written; 'fixed' means
    // it rewrote it to match the evidence. Anything else was cut before air.
    var wasCorrected: Bool { action == "fixed" }
}

struct ChapterSource: Decodable, Identifiable, Sendable {
    let id: String
    let publisher: String?
    let title: String?
    let lang: String?
    let extractionQuality: Double?

    let url: String?
    var link: URL? { url.flatMap(URL.init(string:)) }
}

struct SavedSource: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let publisher: String?
    let type: String
    let lang: String?
    let status: String
    let extractionQuality: Double?
    // Set whenever status is a failure; it is the reason to put on screen.
    let error: String?
    let capturedAt: Date
    // True once the source has been clustered into a story on the laptop, so it
    // is a candidate for the next episode.
    let inStory: Bool
    // One of the server's shelves (config.CATEGORIES); nil on sources analysed
    // before the shelves existed.
    let category: String?

    let url: String?
    var link: URL? { url.flatMap(URL.init(string:)) }
}

enum APIError: LocalizedError {
    case notConfigured
    case badURL
    case unreachable(String)
    case http(Int, String)
    case undecodable(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return String(localized: "Add your token in Settings to load your briefings.")
        case .badURL:
            return String(localized: "Invalid server address.")
        case let .unreachable(reason):
            return String(localized: "Server unreachable. \(reason)")
        case let .http(code, body):
            // The server always answers with {"error": "..."}; showing it beats a
            // status code the reader cannot act on.
            switch code {
            case 401: return String(localized: "Token refused by the server.")
            case 404: return String(localized: "Not found on the server.")
            default: return String(localized: "Error \(code). \(body)")
            }
        case let .undecodable(reason):
            return String(localized: "Unreadable server response: \(reason)")
        }
    }
}

// ISO8601DateFormatter is a class Foundation does not mark Sendable, and the
// decoding closure has to be @Sendable. The instance is configured once and only
// read afterwards, and the decoder that holds it belongs to the API actor, so a
// single call decodes at a time.
private final class ISO8601Parser: @unchecked Sendable {
    private let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    func date(from text: String) -> Date? { formatter.date(from: text) }
}

actor API {
    static let shared = API()

    private let decoder: JSONDecoder

    init() {
        let parser = ISO8601Parser()
        let decoder = JSONDecoder()
        // .iso8601 rejects fractional seconds, which every timestamp here has:
        // Postgres timestamptz comes back as 2026-08-29T18:00:00.000Z.
        decoder.dateDecodingStrategy = .custom { input in
            let text = try input.singleValueContainer().decode(String.self)
            guard let date = parser.date(from: text) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: input.codingPath, debugDescription: "expected an ISO 8601 date, got \(text)")
                )
            }
            return date
        }
        self.decoder = decoder
    }

    func episodes() async throws -> [EpisodeSummary] {
        try await get("/episodes", as: EpisodeList.self).episodes
    }

    func episode(id: String) async throws -> EpisodeDetail {
        try await get("/episodes/\(id)", as: EpisodeDetail.self)
    }

    /// The saved sources, plus the server's own count of what an episode can be
    /// built from and the minimum it demands. The app never recomputes that
    /// rule: the counter on screen and the refusal on the wire share one source.
    func sources() async throws -> SourceBatch {
        try await get("/sources", as: SourceBatch.self)
    }

    /// Asks the server to queue a briefing. Returns the id of the queued
    /// episode; a refusal (409 double generation, 503 cloud not wired) arrives
    /// as APIError.http carrying the server's French message.
    /// A category scopes the episode to one shelf; the four-link rule then
    /// applies to that shelf alone, server side.
    func generateEpisode(targetMin: Int, category: String? = nil) async throws -> String {
        try await post("/episodes", body: GenerateBody(target_min: targetMin, category: category), as: GenerateAck.self).episode_id
    }

    /// Tells the server which language to write and speak the next episodes in.
    /// Only fires when it changed, because nothing else about this is worth a
    /// round trip on every launch — and a failure is silent by design: an
    /// episode in the previous language beats an app that refuses to open.
    func reportLanguageIfChanged() async {
        let code = AppLocale.code
        guard Config.isConfigured, Config.reportedLanguage != code else { return }
        do {
            _ = try await put("/me/language", body: LanguageBody(language: code), as: LanguageAck.self)
            Config.reportedLanguage = code
        } catch {
            // Left unreported: it retries on the next launch.
        }
    }

    /// DELETE /me. The server kills both tokens before it answers and erases
    /// the rest durably: from this side the account is gone when this returns.
    func deleteAccount() async throws {
        var request = try makeRequest(for: "/me")
        request.httpMethod = "DELETE"
        _ = try await perform(request, as: DeleteAck.self)
    }

    private struct DeleteAck: Decodable { let status: String }
    /// The account as the server shows it. snake_case on the wire like the
    /// other write endpoints, because PUT /me answers with the same shape.
    struct VoiceOption: Decodable, Identifiable, Sendable, Equatable {
        let id: String
        let name: String
        let style: String
        let language: String
    }

    struct Me: Decodable, Sendable, Equatable {
        let language: String
        let voiceId: String?
        /// The narrator the next episode will actually use, override or default.
        let voice: String?
        let voices: [VoiceOption]
        let targetMinutes: Int
        let maxMinutes: Int
        let minimumSources: Int
        let dailyAt: String
        let feedUrl: String?
        let ingestAddress: String?

        enum CodingKeys: String, CodingKey {
            case language, voice, voices
            case voiceId = "voice_id"
            case targetMinutes = "target_minutes"
            case maxMinutes = "max_minutes"
            case minimumSources = "minimum_sources"
            case dailyAt = "daily_at"
            case feedUrl = "feed_url"
            case ingestAddress = "ingest_address"
        }

        var feedURL: URL? { feedUrl.flatMap(URL.init(string:)) }
    }

    func me() async throws -> Me {
        try await get("/me", as: Me.self)
    }

    /// nil clears the override and the language default takes over again.
    func updateVoice(_ voiceId: String?) async throws -> Me {
        try await put("/me", json: ["voice_id": voiceId as Any], as: Me.self)
    }

    private struct EpisodeList: Decodable { let episodes: [EpisodeSummary] }
    private struct LanguageBody: Encodable { let language: String }
    private struct LanguageAck: Decodable { let language: String }
    struct SourceBatch: Decodable, Sendable {
        let sources: [SavedSource]
        // Older servers send neither; the card then shows the list count alone.
        let available: Int?
        let minimum: Int?
        // The shelves, in the server's order. Absent on older servers.
        let categories: [String]?
    }
    private struct GenerateBody: Encodable { let target_min: Int; let category: String? }
    private struct GenerateAck: Decodable { let episode_id: String }

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try await perform(makeRequest(for: path), as: type)
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body, as type: T.Type) async throws -> T {
        var request = try makeRequest(for: path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request, as: type)
    }

    /// For a body that has to carry an explicit null, which Encodable drops.
    private func put<T: Decodable>(_ path: String, json: [String: Any], as type: T.Type) async throws -> T {
        var request = try makeRequest(for: path)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let cleaned = json.mapValues { value -> Any in
            if case Optional<Any>.none = value { return NSNull() }
            return value
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: cleaned)
        return try await perform(request, as: type)
    }

    private func put<T: Decodable, Body: Encodable>(_ path: String, body: Body, as type: T.Type) async throws -> T {
        var request = try makeRequest(for: path)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request, as: type)
    }

    /// The two sign-in endpoints are the only calls with no bearer token: they
    /// are what mints one, so they skip `makeRequest`'s isConfigured guard.
    /// Mirrors `perform`'s request/response handling so a sign-in failure reads
    /// like every other one, just wrapped in AuthError instead of APIError.
    func postUnauthenticated<Body: Encodable, T: Decodable>(path: String, body: Body, as type: T.Type) async throws -> T {
        guard let endpoint = URL(string: Config.baseURL + path) else { throw APIError.badURL }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 20

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw AuthError.server(error.localizedDescription)
        }

        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AuthError.server(message ?? String(localized: "Sign-in was refused. Please try again."))
        }

        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw AuthError.server(Self.reason(error))
        }
    }

    private func makeRequest(for path: String) throws -> URLRequest {
        guard Config.isConfigured else { throw APIError.notConfigured }
        guard let endpoint = URL(string: Config.baseURL + path) else { throw APIError.badURL }

        var request = URLRequest(url: endpoint)
        request.setValue("Bearer \(Config.sessionToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            // URLError is already localised by the system, so this stays readable.
            throw APIError.unreachable(error.localizedDescription)
        }

        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.http(code, message ?? "")
        }

        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw APIError.undecodable(Self.reason(error))
        }
    }

    // DecodingError.localizedDescription says only that the data is in the wrong
    // format, which is unactionable on a phone; the field that broke is the point.
    private static func reason(_ error: Error) -> String {
        guard let error = error as? DecodingError else { return error.localizedDescription }
        switch error {
        case let .keyNotFound(key, context):
            return "field “\(key.stringValue)” missing (\(Self.path(context)))"
        case let .typeMismatch(_, context), let .valueNotFound(_, context), let .dataCorrupted(context):
            return "\(context.debugDescription) (\(Self.path(context)))"
        @unknown default:
            return error.localizedDescription
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let parts = context.codingPath.map(\.stringValue)
        return parts.isEmpty ? "response root" : parts.joined(separator: ".")
    }
}
