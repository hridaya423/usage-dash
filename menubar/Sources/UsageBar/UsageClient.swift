import Foundation
struct AgentSplitDTO: Codable, Equatable {
    let agent: String
    let cost: Double
    let tokens: Double
    let sessions: Int?
}
struct DayDTO: Codable {
    let period: String
    let cost: Double
    let tokens: Double
    let agents: [AgentSplitDTO]
    let sessions: Int?
}
struct HourBucketDTO: Codable {
    let label: String
    let agents: [AgentSplitDTO]
}
struct StatPair: Codable {
    let cost: Double
    let tokens: Double
}
struct ModelRowDTO: Codable {
    let name: String
    let cost: Double
    let tokens: Double
    let share: Double
}
struct RangeAgentDTO: Codable {
    let agent: String
    let label: String
    let color: String
    let cost: Double
    let tokens: Double
    let sessions: Int
}
struct RangeDigestDTO: Codable {
    let label: String
    let totalCost: Double
    let totalTokens: Double
    let sessions: Int
    let agents: [RangeAgentDTO]
    let models: [ModelRowDTO]
}
enum RangeKey: String, CaseIterable, Identifiable {
    case h24 = "24h"
    case d7 = "7d"
    case d30 = "30d"
    case d90 = "90d"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .h24: return "24h"
        case .d7: return "7d"
        case .d30: return "30d"
        case .d90: return "90d"
        }
    }
}
struct SummaryDTO: Codable {
    let fetchedAt: String
    let refreshing: Bool
    let etaSeconds: Double?
    let stale: Bool
    let sources: [String]
    let machines: [String]?
    let today: DayDTO?
    let week: StatPair
    let month: StatPair
    let daily: [DayDTO]
    let weekly: [DayDTO]
    let hourly: [HourBucketDTO]
    let ranges: [String: RangeDigestDTO]
    func range(_ key: RangeKey) -> RangeDigestDTO? { ranges[key.rawValue] }
}
enum UsageError: Error {
    case badResponse
}
final class UsageClient: Sendable {
    func fetchSummary(baseURL: URL, force: Bool) async throws -> SummaryDTO {
        var url = baseURL.appending(path: "api/usage/summary")
        if force {
            url.append(queryItems: [URLQueryItem(name: "refresh", value: "1")])
        }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw UsageError.badResponse
        }
        return try JSONDecoder().decode(SummaryDTO.self, from: data)
    }
}
