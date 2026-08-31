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
            return "Ajoutez votre jeton dans les réglages pour charger vos briefings."
        case .badURL:
            return "Adresse du serveur invalide."
        case let .unreachable(reason):
            return "Serveur injoignable. \(reason)"
        case let .http(code, body):
            // The server always answers with {"error": "..."}; showing it beats a
            // status code the reader cannot act on.
            switch code {
            case 401: return "Jeton refusé par le serveur."
            case 404: return "Introuvable sur le serveur."
            default: return "Erreur \(code). \(body)"
            }
        case let .undecodable(reason):
            return "Réponse du serveur illisible : \(reason)"
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
                    .init(codingPath: input.codingPath, debugDescription: "date ISO 8601 attendue, reçu \(text)")
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

    func sources() async throws -> [SavedSource] {
        try await get("/sources", as: SourceList.self).sources
    }

    /// Asks the server to queue a briefing. Returns the id of the queued
    /// episode; a refusal (409 double generation, 503 cloud not wired) arrives
    /// as APIError.http carrying the server's French message.
    func generateEpisode(targetMin: Int) async throws -> String {
        try await post("/episodes", body: GenerateBody(target_min: targetMin), as: GenerateAck.self).episode_id
    }

    private struct EpisodeList: Decodable { let episodes: [EpisodeSummary] }
    private struct SourceList: Decodable { let sources: [SavedSource] }
    private struct GenerateBody: Encodable { let target_min: Int }
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

    private func makeRequest(for path: String) throws -> URLRequest {
        guard Config.isConfigured else { throw APIError.notConfigured }
        guard let endpoint = URL(string: Config.baseURL + path) else { throw APIError.badURL }

        var request = URLRequest(url: endpoint)
        request.setValue("Bearer \(Config.apiToken)", forHTTPHeaderField: "Authorization")
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
            return "champ « \(key.stringValue) » absent (\(Self.path(context)))"
        case let .typeMismatch(_, context), let .valueNotFound(_, context), let .dataCorrupted(context):
            return "\(context.debugDescription) (\(Self.path(context)))"
        @unknown default:
            return error.localizedDescription
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let parts = context.codingPath.map(\.stringValue)
        return parts.isEmpty ? "racine de la réponse" : parts.joined(separator: ".")
    }
}
