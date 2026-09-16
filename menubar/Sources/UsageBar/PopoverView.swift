import SwiftUI
enum ChartMetric: String, CaseIterable {
    case tokens, cost
    var title: String { self == .tokens ? "tokens" : "cost" }
    func value(for split: AgentSplitDTO) -> Double { self == .tokens ? split.tokens : split.cost }
    func value(for agent: RangeAgentDTO) -> Double { self == .tokens ? agent.tokens : agent.cost }
}
func agentColor(_ name: String) -> Color {
    let rgb = ditherFill(name)
    return Color(
        red: Double(rgb.r) / 255,
        green: Double(rgb.g) / 255,
        blue: Double(rgb.b) / 255
    )
}
private func rgbColor(_ rgb: RGB) -> Color {
    Color(red: Double(rgb.r) / 255, green: Double(rgb.g) / 255, blue: Double(rgb.b) / 255)
}
private let heatCell = 9
private let weekdayGutter: CGFloat = 26
private let monthRowH: CGFloat = 13
func dateFromISO(_ iso: String) -> Date? {
    let parts = iso.split(separator: "-")
    guard parts.count == 3,
          let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2])
    else { return nil }
    return Calendar(identifier: .gregorian).date(from: DateComponents(year: y, month: m, day: d))
}
func isoFromDate(_ date: Date) -> String {
    let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}
func chartPoints(_ summary: SummaryDTO, range: RangeKey) -> [ChartPoint] {
    switch range {
    case .h24:
        return summary.hourly.map {
            ChartPoint(label: $0.label, tick: String($0.label.prefix(2)), agents: $0.agents)
        }
    case .d7:
        return summary.daily.suffix(7).map {
            ChartPoint(label: shortDay($0.period), tick: shortDay($0.period), agents: $0.agents)
        }
    case .d30:
        return summary.daily.suffix(30).map {
            ChartPoint(label: shortDay($0.period), tick: shortDay($0.period), agents: $0.agents)
        }
    case .d90:
        return summary.weekly.map {
            ChartPoint(label: "wk \(shortDay($0.period))", tick: "wk \(shortDay($0.period))", agents: $0.agents)
        }
    }
}
func heatColumns(_ summary: SummaryDTO, metric: ChartMetric) -> [[HeatCell]] {
    let days = summary.daily
    guard !days.isEmpty else { return [] }
    let maxV = max(days.map { metric == .cost ? $0.cost : $0.tokens }.max() ?? 0, 1e-9)
    var cells = days.map { day in
        HeatCell(
            date: day.period,
            level: heatLevel(metric == .cost ? day.cost : day.tokens, max: maxV),
            cost: day.cost,
            tokens: day.tokens
        )
    }
    if let first = dateFromISO(days[0].period) {
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: first)
        let lead = (weekday + 5) % 7
        for i in 0..<lead {
            var back = first
            back = Calendar.current.date(byAdding: .day, value: -(lead - i), to: back) ?? back
            cells.insert(
                HeatCell(date: isoFromDate(back), level: -1, cost: 0, tokens: 0),
                at: i
            )
        }
    }
    var columns: [[HeatCell]] = []
    for i in stride(from: 0, to: cells.count, by: 7) {
        columns.append(Array(cells[i..<min(i + 7, cells.count)]))
    }
    return columns
}
private func modelShortName(_ raw: String) -> String {
    if raw.count > 9, raw.suffix(9).hasPrefix("-"),
       raw.suffix(8).allSatisfy(\.isNumber) {
        return String(raw.dropLast(9))
    }
    return raw
}
struct PopoverView: View {
    @EnvironmentObject private var store: UsageStore
    @AppStorage("popoverMetric") private var metricRaw = ChartMetric.tokens.rawValue
    @State private var range: RangeKey = .d30
    @State private var showSettings = false
    @State private var breakdownView = "model"
    @State private var hiddenAgents = Set<String>()
    private var metric: ChartMetric {
        ChartMetric(rawValue: metricRaw) ?? .tokens
    }
    private func machineIDs(_ summary: SummaryDTO) -> [String] {
        summary.machines ?? summary.sources
    }
    static let tint = Color.black.opacity(0.42)
    private let mono9 = Font.system(size: 9, design: .monospaced)
    private let mono10 = Font.system(size: 10, design: .monospaced)
    var body: some View {
        Group {
            if showSettings {
                SettingsView {
                    withAnimation(.easeInOut(duration: 0.15)) { showSettings = false }
                }
                .frame(width: 360)
            } else {
                main
            }
        }
        .preferredColorScheme(.dark)
    }
    private var main: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                UpdateLine(
                    refreshing: store.refreshing || store.summary?.refreshing == true,
                    eta: store.summary?.etaSeconds
                )
                header
                if let summary = store.summary {
                    controls
                    if let digest = summary.range(range) {
                        heroSection(digest)
                        chartPanel(summary, digest: digest)
                        activitySection(summary)
                        breakdownSection(summary, digest: digest)
                    }
                } else {
                    emptyState
                }
                footer
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)
        }
        .scrollIndicators(.hidden)
        .contentMargins(.trailing, 0, for: .scrollIndicators)
        .frame(width: 360)
        .frame(maxHeight: 640)
    }
    private func sectionLabel(_ title: String, meta: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            Spacer()
            if let meta {
                Text(meta)
                    .font(mono9)
                    .foregroundStyle(.tertiary)
            }
        }
    }
    private func segmented<T: Hashable>(
        _ options: [(T, String)],
        selection: Binding<T>
    ) -> some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { (value, label) in
                Button {
                    selection.wrappedValue = value
                } label: {
                    Text(label)
                        .font(.system(size: 10, weight: selection.wrappedValue == value ? .semibold : .regular))
                        .foregroundStyle(selection.wrappedValue == value ? Color.black : .secondary)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3.5)
                        .background(
                            selection.wrappedValue == value ? Color.white : Color.clear,
                            in: RoundedRectangle(cornerRadius: 5, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5)
        )
        .animation(.easeInOut(duration: 0.15), value: selection.wrappedValue)
    }
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text("Usage")
                .font(.system(size: 14, weight: .semibold))
            if let label = store.summary?.range(range)?.label, !label.isEmpty {
                Text("/ \(label)")
                    .font(mono10)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            if store.refreshing || store.summary?.refreshing == true {
                Text(updatingLabel)
                    .font(mono9)
                    .foregroundStyle(.tertiary)
            } else if let updated = store.lastUpdated {
                Text("updated \(formatClock(updated))")
                    .font(mono9)
                    .foregroundStyle(.tertiary)
            }
            Button {
                Task { await store.refresh(force: true) }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .rotationEffect(.degrees(store.refreshing ? 360 : 0))
                    .animation(
                        store.refreshing
                            ? .linear(duration: 0.8).repeatForever(autoreverses: false)
                            : .default,
                        value: store.refreshing
                    )
            }
            .buttonStyle(.borderless)
            .keyboardShortcut("r")
            .help("Refresh")
            .foregroundStyle(.secondary)
        }
    }
    private var updatingLabel: String {
        guard let eta = store.summary?.etaSeconds else { return "updating" }
        return eta <= 1 ? "updating, almost done" : "updating ~\(Int(eta))s"
    }
    private var controls: some View {
        HStack(spacing: 10) {
            segmented(
                [(.cost, "Cost"), (.tokens, "Tokens")],
                selection: Binding(
                    get: { metric },
                    set: { metricRaw = $0.rawValue }
                )
            )
            Spacer()
            segmented(
                RangeKey.allCases.map { ($0, $0.title) },
                selection: $range
            )
        }
    }
    private func heroSection(_ digest: RangeDigestDTO) -> some View {
        let total = metric == .cost ? digest.totalCost : digest.totalTokens
        let rows = digest.agents.filter { metric.value(for: $0) > 0 }
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(metric == .cost ? formatMoney(total) : formatCompactTokens(total))
                        .font(.system(size: 30, weight: .semibold, design: .monospaced))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.easeOut(duration: 0.2), value: total)
                    if metric == .tokens {
                        Text("tokens")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }
                Text("\(digest.sessions) sessions · API estimate")
                    .font(mono9)
                    .foregroundStyle(.tertiary)
            }
            if !rows.isEmpty {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(rows, id: \.agent) { agent in
                            let share = total > 0 ? metric.value(for: agent) / total : 0
                            if share > 0 {
                                DitherTile(color: ditherColor(named: agent.color))
                                    .frame(width: max(3, geo.size.width * CGFloat(share) - 2))
                                    .opacity(hiddenAgents.contains(agent.agent) ? 0.25 : 1)
                            }
                        }
                    }
                }
                .frame(height: 13)
                .clipShape(RoundedRectangle(cornerRadius: 3.5, style: .continuous))
                .animation(.easeOut(duration: 0.2), value: chartSignature)
            }
            VStack(alignment: .leading, spacing: 0) {
                if !hiddenAgents.isEmpty {
                    Button {
                        hiddenAgents.removeAll()
                    } label: {
                        Text("reset \(hiddenAgents.count) filter\(hiddenAgents.count > 1 ? "s" : "")")
                            .font(mono9)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.16), lineWidth: 0.5)
                            )
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 6)
                }
                ForEach(digest.agents, id: \.agent) { agent in
                    agentRow(agent, totalCost: digest.totalCost, totalTokens: digest.totalTokens, total: total)
                }
            }
        }
    }
    private func agentRow(_ agent: RangeAgentDTO, totalCost: Double, totalTokens: Double, total: Double) -> some View {
        let hidden = hiddenAgents.contains(agent.agent)
        let share = total > 0 ? metric.value(for: agent) / total * 100 : 0
        let costShare = totalCost > 0 ? agent.cost / totalCost * 100 : 0
        let tokShare = totalTokens > 0 ? agent.tokens / totalTokens * 100 : 0
        return Button {
            toggleAgent(agent.agent)
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(rgbColor(ditherColor(named: agent.color)))
                    .frame(width: 7, height: 7)
                Text(agent.label)
                    .font(.system(size: 11, weight: hidden ? .regular : .medium))
                    .strikethrough(hidden)
                    .foregroundStyle(hidden ? .tertiary : .primary)
                Spacer()
                Text(metric == .cost ? formatMoney(agent.cost) : formatCompactTokens(agent.tokens))
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(hidden ? .tertiary : .primary)
                Text(formatPct(share))
                    .font(.system(size: 10, design: .monospaced))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(.tertiary)
                    .frame(width: 42, alignment: .trailing)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(hidden ? 0.45 : 1)
            .animation(.easeOut(duration: 0.2), value: metric)
            .animation(.easeOut(duration: 0.2), value: range)
        }
        .buttonStyle(.plain)
        .help("\(agent.sessions) session\(agent.sessions == 1 ? "" : "s") · "
              + formatPct(costShare) + " of cost · " + formatPct(tokShare) + " of tokens"
              + (hidden ? " — click to show" : " — click to hide"))
    }
    private func toggleAgent(_ agent: String) {
        guard let digest = store.summary?.range(range) else { return }
        if hiddenAgents.contains(agent) {
            hiddenAgents.remove(agent)
        } else if digest.agents.count - hiddenAgents.count > 1 {
            hiddenAgents.insert(agent)
        }
    }
    private func visibleMax(_ points: [ChartPoint]) -> Double {
        points.map { point in
            point.agents.reduce(0) { acc, split in
                hiddenAgents.contains(split.agent) ? acc : acc + metric.value(for: split)
            }
        }.max() ?? 0
    }
    private var chartSignature: String {
        "\(range.rawValue)|\(metric.rawValue)|\(hiddenAgents.sorted().joined(separator: ","))"
    }
    private func chartPanel(_ summary: SummaryDTO, digest: RangeDigestDTO) -> some View {
        let points = chartPoints(summary, range: range)
        let hasData = points.contains { point in
            point.agents.contains { !hiddenAgents.contains($0.agent) && metric.value(for: $0) > 0 }
        }
        let maxV = visibleMax(points)
        return VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .top) {
                if hasData {
                    DitherAreaChart(
                        points: points,
                        metric: metric,
                        hidden: hiddenAgents,
                        maxV: maxV
                    )
                    .frame(height: 150)
                    .id(chartSignature)
                    .transition(.opacity)
                } else {
                    Text(range == .h24 ? "no sessions in the last 24 hours" : "no usage in range")
                        .font(mono10)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 150)
                }
                GeometryReader { geo in
                    ForEach([1, 2, 3], id: \.self) { i in
                        let frac = Double(i) / 4
                        Text(metric == .tokens
                             ? formatCompactTokens(maxV * frac)
                             : formatMoneyShort(maxV * frac))
                            .font(.system(size: 7, design: .monospaced))
                            .foregroundStyle(.quaternary)
                            .frame(width: geo.size.width - 6, alignment: .trailing)
                            .position(
                                x: geo.size.width / 2,
                                y: geo.size.height * (1 - frac) - 5
                            )
                    }
                }
                .frame(height: 150)
                .allowsHitTesting(false)
            }
            .animation(.easeInOut(duration: 0.2), value: chartSignature)
            xTicks(points)
            if let top = digest.models.first {
                Text("top model \(modelShortName(top.name)) · \(formatMoney(top.cost)) · \(Int(top.share))%")
                    .font(mono9)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(10)
        .background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.white.opacity(0.09), lineWidth: 0.5)
        )
    }
    private func xTicks(_ points: [ChartPoint]) -> some View {
        let n = points.count
        let maxTicks = (range == .h24 || range == .d90) ? 6 : 4
        var indices = Set<Int>()
        if n > 1 {
            for i in 0..<maxTicks {
                indices.insert(Int((Double(i) / Double(maxTicks - 1) * Double(n - 1)).rounded()))
            }
        }
        return GeometryReader { geo in
            let w = geo.size.width
            ForEach(indices.sorted(), id: \.self) { i in
                if i >= 0, i < n {
                    Text(points[i].tick)
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.quaternary)
                        .position(
                            x: tickX(i, count: n, width: w),
                            y: 4
                        )
                }
            }
        }
        .frame(height: 10)
    }
    private func tickX(_ index: Int, count: Int, width: CGFloat) -> CGFloat {
        let frac = count > 1 ? CGFloat(index) / CGFloat(count - 1) : 0
        return min(max(frac * width, 18), width - 18)
    }
    private func activitySection(_ summary: SummaryDTO) -> some View {
        let columns = heatColumns(summary, metric: metric)
        let maxV = summary.daily.map { metric == .cost ? $0.cost : $0.tokens }.max() ?? 0
        let total = summary.daily.reduce(0) { $0 + (metric == .cost ? $1.cost : $1.tokens) }
        let gap = columns.count > 40 ? 3 : 2
        let today = isoFromDate(Date())
        return VStack(alignment: .leading, spacing: 6) {
            sectionLabel(
                "Activity",
                meta: "peak \(metric == .cost ? formatMoney(maxV) : formatCompactTokens(maxV) + " tok") · \(metric == .cost ? formatMoney(total) : formatCompactTokens(total)) total"
            )
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(0..<7, id: \.self) { row in
                        Text(row == 1 ? "Mon" : row == 3 ? "Wed" : row == 5 ? "Fri" : "")
                            .font(.system(size: 7, design: .monospaced))
                            .foregroundStyle(.quaternary)
                            .frame(width: weekdayGutter - 4, height: CGFloat(heatCell + gap), alignment: .leading)
                    }
                }
                .padding(.top, monthRowH)
                ScrollView(.horizontal, showsIndicators: false) {
                    HeatmapView(columns: columns, gap: gap, metric: metric, today: today)
                }
                .defaultScrollAnchor(.trailing)
                .contentMargins(.bottom, 0, for: .scrollIndicators)
            }
            HStack(spacing: 3) {
                Spacer()
                Text("less")
                    .font(mono9)
                    .foregroundStyle(.quaternary)
                ForEach(0..<6, id: \.self) { level in
                    if let img = cachedImage("sw:\(level)", { renderSwatch(level: level, size: 5) }) {
                        Image(decorative: img, scale: 1)
                            .resizable()
                            .interpolation(.none)
                            .frame(width: 10, height: 10)
                    }
                }
                Text("more")
                    .font(mono9)
                    .foregroundStyle(.quaternary)
            }
        }
    }
    private struct BreakRow: Identifiable, Equatable {
        let id: String
        let label: String
        let cost: Double
        let tokens: Double
        let share: Double
        let color: RGB
        var dot: RGB {
            color.r == 255 && color.g == 150 ? (255, 195, 130) : (140, 140, 150)
        }
        static func == (l: Self, r: Self) -> Bool {
            l.id == r.id && l.cost == r.cost && l.tokens == r.tokens && l.share == r.share && l.color.r == r.color.r && l.color.g == r.color.g && l.color.b == r.color.b
        }
    }
    private func modelFamily(_ name: String) -> String {
        var s = name.lowercased()
        if let slash = s.firstIndex(of: "/") {
            s = String(s[s.index(after: slash)...])
        }
        let tiers: Set<String> = [
            "max", "high", "hi", "med", "medium", "mem", "min", "mini",
            "low", "lo", "fast", "turbo", "thinking", "latest", "preview",
            "free", "pro", "plus", "chat", "code", "instruct", "exp",
            "beta", "test", "dev", "hf",
        ]
        let parts = s.split(separator: "-").map(String.init)
        var cut = parts.count
        if parts.count > 2 {
            for i in 2..<parts.count
            where tiers.contains(parts[i]) || (parts[i].allSatisfy(\.isNumber) && parts[i].count >= 4) {
                cut = i
                break
            }
        }
        return parts.prefix(cut).joined(separator: "-")
    }
    private func breakdownRows(_ summary: SummaryDTO, digest: RangeDigestDTO) -> [BreakRow] {
        let grey: RGB = (92, 92, 100)
        if breakdownView == "model" {
            var fams: [String: (cost: Double, tokens: Double)] = [:]
            for model in digest.models {
                let fam = modelFamily(model.name)
                fams[fam, default: (0, 0)].cost += model.cost
                fams[fam, default: (0, 0)].tokens += model.tokens
            }
            return fams.map { name, v in
                BreakRow(
                    id: name,
                    label: name,
                    cost: v.cost,
                    tokens: v.tokens,
                    share: digest.totalCost > 0 ? v.cost / digest.totalCost * 100 : 0,
                    color: name.hasPrefix("claude") ? (255, 150, 50) : grey
                )
            }
            .sorted { $0.cost > $1.cost }
        }
        let dayRows: [DayDTO]
        switch range {
        case .h24: dayRows = Array(summary.daily.suffix(1))
        case .d7: dayRows = Array(summary.daily.suffix(7))
        case .d30: dayRows = Array(summary.daily.suffix(30))
        case .d90: dayRows = summary.weekly
        }
        return dayRows
            .map {
                BreakRow(
                    id: $0.period,
                    label: range == .d90 ? "wk \(shortDay($0.period))" : shortDay($0.period),
                    cost: $0.cost,
                    tokens: $0.tokens,
                    share: digest.totalCost > 0 ? $0.cost / digest.totalCost * 100 : 0,
                    color: grey
                )
            }
            .sorted { $0.id > $1.id }
    }
    private func breakdownSection(_ summary: SummaryDTO, digest: RangeDigestDTO) -> some View {
        let rows = breakdownRows(summary, digest: digest)
        let shown = breakdownView == "model" ? Array(rows.prefix(8)) : rows
        let rest = rows.dropFirst(shown.count)
        let shareMax = max(shown.map(\.share).max() ?? 0, 1e-9)
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                sectionLabel("Breakdown")
                segmented(
                    [("model", "Model"), ("day", "Day")],
                    selection: $breakdownView
                )
            }
            VStack(spacing: 0) {
                HStack {
                    Text(breakdownView == "model" ? "Model" : range == .d90 ? "Week" : "Day")
                    Spacer()
                    Text("Cost")
                        .frame(width: 70, alignment: .trailing)
                    Text("Share")
                        .frame(width: 48, alignment: .trailing)
                    Text("Tokens")
                        .frame(width: 62, alignment: .trailing)
                }
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5.5)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(Color.white.opacity(0.07)).frame(height: 0.5)
                }
                ForEach(Array(shown.enumerated()), id: \.element.id) { i, row in
                    BreakRowView(
                        row: row,
                        frac: row.share / shareMax,
                        sep: i < shown.count - 1 || !rest.isEmpty
                    )
                }
                if !rest.isEmpty {
                    HStack {
                        Text("· \(rest.count) more")
                            .foregroundStyle(.tertiary)
                        Spacer()
                        Text(formatMoney(rest.reduce(0) { $0 + $1.cost }))
                            .frame(width: 70, alignment: .trailing)
                        Text(formatPct(rest.reduce(0) { $0 + $1.share }))
                            .frame(width: 48, alignment: .trailing)
                        Text(formatCompactTokens(rest.reduce(0) { $0 + $1.tokens }))
                            .frame(width: 62, alignment: .trailing)
                    }
                    .font(.system(size: 10, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4.5)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.09), lineWidth: 0.5)
            )
        }
    }
    private struct BreakRowView: View, Equatable {
        let row: BreakRow
        let frac: Double
        let sep: Bool
        @State private var hover = false
        nonisolated static func == (l: Self, r: Self) -> Bool {
            l.row == r.row && l.frac == r.frac && l.sep == r.sep
        }
        var body: some View {
            HStack {
                ZStack(alignment: .leading) {
                    GeometryReader { geo in
                        let w = max(0, geo.size.width * frac - 4)
                        HatchFill(color: row.color)
                            .frame(width: w, height: geo.size.height - 4)
                            .clipShape(RoundedRectangle(cornerRadius: 2.5, style: .continuous))
                            .position(x: w / 2 + 2, y: geo.size.height / 2)
                    }
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                            .fill(rgbColor(row.dot))
                            .frame(width: 6, height: 6)
                        Text(row.label)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 16, alignment: .leading)
                Text(formatMoney(row.cost))
                    .frame(width: 70, alignment: .trailing)
                Text(formatPct(row.share))
                    .foregroundStyle(.secondary)
                    .frame(width: 48, alignment: .trailing)
                Text(formatCompactTokens(row.tokens))
                    .foregroundStyle(.secondary)
                    .frame(width: 62, alignment: .trailing)
            }
            .font(.system(size: 10, design: .monospaced))
            .monospacedDigit()
            .animation(.easeOut(duration: 0.2), value: row.cost)
            .padding(.horizontal, 10)
            .padding(.vertical, 4.5)
            .background(Color.white.opacity(hover ? 0.05 : 0))
            .overlay(alignment: .bottom) {
                if sep {
                    Rectangle().fill(Color.white.opacity(0.05)).frame(height: 0.5)
                }
            }
            .contentShape(Rectangle())
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.15), value: hover)
        }
    }
    private var emptyState: some View {
        VStack(spacing: 6) {
            ProgressView()
                .controlSize(.small)
            Text(store.isOffline ? "Can't reach server" : "Loading…")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            if store.isOffline {
                Text(store.baseURL)
                    .font(mono9)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
    private var footer: some View {
        HStack(spacing: 9) {
            if let summary = store.summary {
                let ids = machineIDs(summary)
                HStack(spacing: 5) {
                    ForEach(ids, id: \.self) { source in
                        Circle()
                            .fill(summary.sources.contains(source) ? Color.green : Color.white.opacity(0.22))
                            .frame(width: 5, height: 5)
                    }
                }
                .help(
                    ids.map { "\($0): \(summary.sources.contains($0) ? "live" : "offline")" }
                        .joined(separator: "  ·  ")
                )
            }
            Spacer()
            iconButton("arrow.up.right.square", help: "Open dashboard") {
                if let url = store.dashboardURL {
                    NSWorkspace.shared.open(url)
                }
            }
            iconButton("arrow.clockwise", help: "Refresh") {
                Task { await store.refresh(force: true) }
            }
            .keyboardShortcut("r")
            iconButton("gearshape", help: "Settings") {
                withAnimation(.easeInOut(duration: 0.15)) { showSettings = true }
            }
            iconButton("power", help: "Quit") {
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .padding(.top, 2)
    }
    private func iconButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .frame(width: 18, height: 14)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .help(help)
    }
}
private struct HeatmapView: View, Equatable {
    let columns: [[HeatCell]]
    let gap: Int
    let metric: ChartMetric
    let today: String
    nonisolated static func == (l: Self, r: Self) -> Bool {
        l.columns == r.columns && l.gap == r.gap && l.metric == r.metric && l.today == r.today
    }
    var body: some View {
        let gridW = CGFloat(columns.count * heatCell + max(0, columns.count - 1) * gap)
        let gridH = CGFloat(7 * heatCell + 6 * gap)
        ZStack(alignment: .topLeading) {
            ForEach(monthLabelPositions(), id: \.x) { mark in
                Text(mark.label)
                    .font(.system(size: 7, design: .monospaced))
                    .foregroundStyle(.quaternary)
                    .position(x: mark.x + 12, y: 5)
            }
            Group {
                if let img = heatmapImage(columns: columns, cell: heatCell, gap: gap, today: today) {
                    Image(decorative: img, scale: 1)
                        .resizable()
                        .interpolation(.none)
                        .frame(width: gridW, height: gridH)
                }
            }
            .offset(y: monthRowH)
            MouseTrack(
                move: { point, view in
                    if let h = hit(point) {
                        view.showRing(center: CGPoint(x: h.x, y: h.y - monthRowH + CGFloat(heatCell) / 2), size: CGFloat(heatCell) + 3)
                        view.setTip(key: "heat\(h.cell.date)") {
                            makeTipView(
                                title: fullDay(h.cell.date),
                                rows: [(nil, metric == .cost ? formatMoney(h.cell.cost) : "\(formatCompactTokens(h.cell.tokens)) tokens", "")]
                            )
                        }
                        view.moveTip(centerX: h.x, centerY: max(h.y - monthRowH - 26, 12))
                    } else {
                        view.hideHover()
                    }
                },
                exit: { view in view.hideHover() }
            )
            .frame(width: gridW, height: gridH)
            .offset(y: monthRowH)
        }
        .frame(width: gridW, height: monthRowH + gridH)
    }
    private func monthLabelPositions() -> [(x: CGFloat, label: String)] {
        var out: [(CGFloat, String)] = []
        var lastMonth = -1
        let stride = CGFloat(heatCell + gap)
        for (ci, col) in columns.enumerated() {
            let mid = col[col.count / 2]
            let month = Int(mid.date.split(separator: "-").dropFirst().first ?? "0") ?? 0
            if month != lastMonth, month > 0 {
                lastMonth = month
                out.append((CGFloat(ci) * stride, monthName(mid.date)))
            }
        }
        return out
    }
    private func monthName(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return "" }
        return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]
    }
    private func hit(_ point: CGPoint) -> (cell: HeatCell, x: CGFloat, y: CGFloat)? {
        let stride = CGFloat(heatCell + gap)
        let ci = Int(point.x / stride)
        let ri = Int(point.y / stride)
        guard ci >= 0, ci < columns.count, ri >= 0, ri < 7 else { return nil }
        let inCellX = point.x - CGFloat(ci) * stride <= CGFloat(heatCell)
        let inCellY = point.y - CGFloat(ri) * stride <= CGFloat(heatCell)
        guard inCellX, inCellY, ri < columns[ci].count else { return nil }
        let cell = columns[ci][ri]
        guard cell.level >= 0 else { return nil }
        return (
            cell,
            CGFloat(ci) * stride + CGFloat(heatCell) / 2,
            CGFloat(ri) * stride + monthRowH
        )
    }
}
private struct UpdateLine: View {
    let refreshing: Bool
    let eta: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startedAt: Date?
    @State private var doneOpacity = 0.0
    private let fillColor = Color(red: 1, green: 150.0 / 255, blue: 50.0 / 255)
    private let tipRGB: RGB = (255, 195, 130)
    var body: some View {
        ZStack(alignment: .leading) {
            if refreshing {
                if reduceMotion {
                    GeometryReader { geo in
                        fillBar(end: geo.size.width * 0.4)
                            .position(x: geo.size.width * 0.2, y: 1.5)
                    }
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
                        let t = tl.date.timeIntervalSince(startedAt ?? tl.date)
                        GeometryReader { geo in
                            let w = geo.size.width
                            if let eta, eta > 0 {
                                let end = w * min(t / eta, 0.97)
                                fillBar(end: end)
                                    .position(x: end / 2, y: 1.5)
                            } else {
                                let band = (w * 0.35).rounded()
                                let head = (t / 1.4).truncatingRemainder(dividingBy: w + band) - band
                                if let img = progressBandImage(color: tipRGB, w: Int(band), h: 3) {
                                    Image(decorative: img, scale: 1)
                                        .frame(width: band, height: 3)
                                        .position(x: head + band / 2, y: 1.5)
                                }
                            }
                        }
                    }
                }
            } else {
                GeometryReader { geo in
                    fillBar(end: geo.size.width)
                        .position(x: geo.size.width / 2, y: 1.5)
                }
                .opacity(doneOpacity)
            }
        }
        .frame(height: 3)
        .clipped()
        .onChange(of: refreshing) { _, now in
            if now {
                startedAt = Date()
                doneOpacity = 0
            } else {
                withAnimation(.easeOut(duration: 0.1)) { doneOpacity = 1 }
                withAnimation(.easeOut(duration: 0.4).delay(0.35)) { doneOpacity = 0 }
            }
        }
    }
    private func fillBar(end: CGFloat) -> some View {
        let e = max(0, end)
        let edge = CGFloat(PROGRESS_EDGE)
        return ZStack(alignment: .leading) {
            Rectangle()
                .fill(fillColor)
                .frame(width: max(0, e - edge), height: 3)
            if let img = progressTipImage(color: tipRGB, h: 3) {
                Image(decorative: img, scale: 1)
                    .frame(width: min(edge, e), height: 3, alignment: .leading)
                    .clipped()
                    .offset(x: max(0, e - edge))
            }
        }
        .frame(width: e, height: 3, alignment: .leading)
    }
}
