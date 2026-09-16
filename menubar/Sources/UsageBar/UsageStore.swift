import AppKit
import Combine
import Foundation
import SwiftUI
enum LabelPreset: String, CaseIterable {
    case todayAndWeekTokens = "todayAndWeekTokens"
    case todayAndWeekCost = "todayAndWeekCost"
    case todayTokens = "todayTokens"
    case todayCost = "todayCost"
    var title: String {
        switch self {
        case .todayAndWeekTokens: return "Today · week tokens"
        case .todayAndWeekCost: return "Today · week cost"
        case .todayTokens: return "Today tokens"
        case .todayCost: return "Today cost"
        }
    }
}
@MainActor
final class UsageStore: ObservableObject {
    @Published private(set) var summary: SummaryDTO?
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var isOffline = false
    @Published private(set) var refreshing = false
    @Published private(set) var iconImage: NSImage
    @Published var labelPreset: LabelPreset {
        didSet { defaults.set(labelPreset.rawValue, forKey: "labelPreset") }
    }
    @Published var pollSeconds: Double {
        didSet { defaults.set(pollSeconds, forKey: "pollSeconds"); restart() }
    }
    @Published var baseURL: String {
        didSet { defaults.set(baseURL, forKey: "baseURL") }
    }
    private let defaults = UserDefaults.standard
    private let client = UsageClient()
    private var pollTask: Task<Void, Never>?
    private var consecutiveFailures = 0
    private let iso = ISO8601DateFormatter()
    init() {
        labelPreset = LabelPreset(rawValue: defaults.string(forKey: "labelPreset") ?? "") ?? .todayAndWeekTokens
        let stored = defaults.double(forKey: "pollSeconds")
        pollSeconds = stored > 0 ? stored : 60
        baseURL = defaults.string(forKey: "baseURL") ?? "http://localhost:3200"
        iconImage = Self.makeIcon(values: [])
        if let data = defaults.data(forKey: "lastSummary"),
           let snapshot = try? JSONDecoder().decode(SummaryDTO.self, from: data) {
            summary = snapshot
            lastUpdated = iso.date(from: snapshot.fetchedAt)
            isOffline = true
            iconImage = Self.makeIcon(values: snapshot.daily.suffix(7).map(\.tokens))
        }
        start()
    }
    var labelText: String {
        guard let summary else { return "—" }
        let todayTokens = summary.today?.tokens ?? 0
        let todayCost = summary.today?.cost ?? 0
        switch labelPreset {
        case .todayAndWeekTokens:
            return "\(formatCompactTokens(todayTokens)) · \(formatCompactTokens(summary.week.tokens))"
        case .todayAndWeekCost:
            return "\(formatMoneyShort(todayCost)) · \(formatMoneyShort(summary.week.cost))"
        case .todayTokens:
            return formatCompactTokens(todayTokens)
        case .todayCost:
            return formatMoneyShort(todayCost)
        }
    }
    var dashboardURL: URL? {
        URL(string: baseURL)
    }
    func start() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                var interval = self.pollSeconds * pow(2, Double(min(self.consecutiveFailures, 3)))
                if self.summary?.refreshing == true {
                    interval = min(interval, 5)
                }
                if ProcessInfo.processInfo.isLowPowerModeEnabled {
                    interval = max(interval, 120)
                }
                interval = min(interval, 300)
                try? await Task.sleep(nanoseconds: UInt64(interval * 1e9))
            }
        }
    }
    func restart() {
        start()
    }
    func refresh(force: Bool = false) async {
        guard let url = URL(string: baseURL) else {
            isOffline = true
            return
        }
        refreshing = true
        do {
            let result = try await client.fetchSummary(baseURL: url, force: force)
            summary = result
            lastUpdated = iso.date(from: result.fetchedAt) ?? Date()
            isOffline = false
            consecutiveFailures = 0
            iconImage = Self.makeIcon(values: result.daily.suffix(7).map(\.tokens))
            if let data = try? JSONEncoder().encode(result) {
                defaults.set(data, forKey: "lastSummary")
            }
            Self.prewarm(result)
        } catch {
            isOffline = true
            consecutiveFailures += 1
        }
        refreshing = false
    }
    private static func prewarm(_ summary: SummaryDTO) {
        Task.detached(priority: .utility) {
            let today = isoFromDate(Date())
            for metric in [ChartMetric.tokens, .cost] {
                let points = chartPoints(summary, range: .d30)
                _ = ditherAreaImage(points: points, metric: metric, hidden: [], cols: 156, rows: 75)
                let columns = heatColumns(summary, metric: metric)
                _ = heatmapImage(
                    columns: columns,
                    cell: 9,
                    gap: columns.count > 40 ? 3 : 2,
                    today: today
                )
            }
        }
    }
    private static func makeIcon(values: [Double]) -> NSImage {
        let size = NSSize(width: 15, height: 14)
        let days = Array(values.suffix(7))
        let image = NSImage(size: size, flipped: false) { rect in
            let count = 7
            let barWidth: CGFloat = 1.7
            let gap: CGFloat = 0.65
            let totalWidth = CGFloat(count) * barWidth + CGFloat(count - 1) * gap
            let startX = (rect.width - totalWidth) / 2
            let maxValue = days.max() ?? 0
            for index in 0..<count {
                let dayIndex = days.count - count + index
                let value = dayIndex >= 0 ? days[dayIndex] : 0
                let height: CGFloat
                let alpha: CGFloat
                if maxValue > 0, value > 0 {
                    height = max(1.4, CGFloat((value / maxValue).squareRoot()) * (rect.height - 1))
                    alpha = 1
                } else {
                    height = 0.9
                    alpha = 0.3
                }
                NSColor.black.withAlphaComponent(alpha).setFill()
                NSBezierPath(
                    roundedRect: NSRect(
                        x: startX + CGFloat(index) * (barWidth + gap),
                        y: 0,
                        width: barWidth,
                        height: height
                    ),
                    xRadius: 0.5,
                    yRadius: 0.5
                ).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
