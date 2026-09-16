import CoreGraphics
import Foundation
import SwiftUI
private let BAYER: [[Double]] = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
].map { row in row.map { (Double($0) + 0.5) / 16 } }
private let BORDER_ALPHA = 0.72
private let OFF_TIER = 0.4
private let LEVEL_ALPHA: [Double] = [0.12, 0.45, 0.6, 0.75, 0.88, 1]
private func cellAlpha(_ level: Int, _ gx: Int, _ gy: Int) -> Double {
    LEVEL_ALPHA[level] * (BAYER[gy & 3][gx & 3] <= 0.62 ? 1 : 0.55)
}
typealias RGB = (r: UInt8, g: UInt8, b: UInt8)
func ditherColor(named name: String) -> RGB {
    switch name {
    case "green": return (40, 210, 110)
    case "blue": return (53, 143, 243)
    case "purple": return (150, 110, 255)
    case "pink": return (240, 90, 190)
    case "orange": return (255, 150, 50)
    case "red": return (240, 70, 70)
    default: return (92, 92, 100)
    }
}
func ditherFill(_ agent: String) -> RGB {
    switch agent.lowercased() {
    case "codex": return (92, 92, 100)
    case "claude": return (255, 150, 50)
    case "droid": return (53, 143, 243)
    case "amp": return (150, 110, 255)
    case "opencode": return (40, 210, 110)
    case "pi": return (240, 90, 190)
    default:
        let rest: [RGB] = [
            (240, 70, 70), (53, 143, 243), (40, 210, 110),
            (150, 110, 255), (240, 90, 190),
        ]
        var hash: Int32 = 0
        for scalar in agent.unicodeScalars {
            hash = hash &* 31 &+ Int32(bitPattern: scalar.value)
        }
        return rest[Int(abs(hash)) % rest.count]
    }
}
nonisolated(unsafe) private var imgCache: [String: CGImage] = [:]
private let imgCacheLock = NSLock()
func cachedImage(_ key: String, _ make: () -> CGImage?) -> CGImage? {
    imgCacheLock.lock()
    defer { imgCacheLock.unlock() }
    if let img = imgCache[key] { return img }
    let img = make()
    imgCache[key] = img
    if imgCache.count > 32 { imgCache.removeAll(keepingCapacity: true) }
    return img
}
private func pointsHash(_ points: [ChartPoint]) -> Int {
    var h = 1469598103934665603
    for point in points {
        h = (h ^ point.label.hashValue) &* 1099511628211
        for split in point.agents {
            h = (h ^ split.agent.hashValue) &* 1099511628211
            h = (h ^ split.tokens.hashValue) &* 1099511628211
            h = (h ^ split.cost.hashValue) &* 1099511628211
        }
    }
    return h
}
func heatHash(_ columns: [[HeatCell]]) -> Int {
    var h = 1469598103934665603
    for col in columns {
        for cell in col {
            h = (h ^ cell.date.hashValue) &* 1099511628211
            h = (h ^ cell.level) &* 1099511628211
        }
    }
    return h
}
private struct PixBuf {
    var data: [UInt8]
    let w: Int
    let h: Int
    init(w: Int, h: Int) {
        self.w = w
        self.h = h
        data = [UInt8](repeating: 0, count: w * h * 4)
    }
    mutating func set(_ x: Int, _ y: Int, _ rgb: RGB, alpha a: Double) {
        guard x >= 0, x < w, y >= 0, y < h else { return }
        let a8 = min(max(a, 0), 1)
        let i = (y * w + x) * 4
        data[i] = UInt8((Double(rgb.r) * a8).rounded())
        data[i + 1] = UInt8((Double(rgb.g) * a8).rounded())
        data[i + 2] = UInt8((Double(rgb.b) * a8).rounded())
        data[i + 3] = UInt8((a8 * 255).rounded())
    }
    func image() -> CGImage? {
        CGImage(
            width: w,
            height: h,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: w * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: CGDataProvider(data: Data(data) as CFData)!,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        )
    }
    func blurred() -> PixBuf {
        let r = 3
        var tmp = [UInt8](repeating: 0, count: data.count)
        var out = PixBuf(w: w, h: h)
        for y in 0..<h {
            var acc = (0, 0, 0, 0)
            for i in 0..<min(r, w) {
                let j = (y * w + i) * 4
                acc = (acc.0 + Int(data[j]), acc.1 + Int(data[j + 1]), acc.2 + Int(data[j + 2]), acc.3 + Int(data[j + 3]))
            }
            var lo = -r - 1
            for x in 0..<w {
                let hi = min(x + r, w - 1)
                if x + r < w {
                    let i = (y * w + x + r) * 4
                    acc = (acc.0 + Int(data[i]), acc.1 + Int(data[i + 1]), acc.2 + Int(data[i + 2]), acc.3 + Int(data[i + 3]))
                }
                lo += 1
                if lo >= 1 {
                    let i = (y * w + lo - 1) * 4
                    acc = (acc.0 - Int(data[i]), acc.1 - Int(data[i + 1]), acc.2 - Int(data[i + 2]), acc.3 - Int(data[i + 3]))
                }
                let n = hi - max(lo, 0) + 1
                let o = (y * w + x) * 4
                tmp[o] = UInt8(acc.0 / n)
                tmp[o + 1] = UInt8(acc.1 / n)
                tmp[o + 2] = UInt8(acc.2 / n)
                tmp[o + 3] = UInt8(acc.3 / n)
            }
        }
        for x in 0..<w {
            var acc = (0, 0, 0, 0)
            for i in 0..<min(r, h) {
                let j = (i * w + x) * 4
                acc = (acc.0 + Int(tmp[j]), acc.1 + Int(tmp[j + 1]), acc.2 + Int(tmp[j + 2]), acc.3 + Int(tmp[j + 3]))
            }
            var lo = -r - 1
            for y in 0..<h {
                let hi = min(y + r, h - 1)
                if y + r < h {
                    let i = ((y + r) * w + x) * 4
                    acc = (acc.0 + Int(tmp[i]), acc.1 + Int(tmp[i + 1]), acc.2 + Int(tmp[i + 2]), acc.3 + Int(tmp[i + 3]))
                }
                lo += 1
                if lo >= 1 {
                    let i = ((lo - 1) * w + x) * 4
                    acc = (acc.0 - Int(tmp[i]), acc.1 - Int(tmp[i + 1]), acc.2 - Int(tmp[i + 2]), acc.3 - Int(tmp[i + 3]))
                }
                let n = hi - max(lo, 0) + 1
                let o = (y * w + x) * 4
                out.data[o] = UInt8(acc.0 / n)
                out.data[o + 1] = UInt8(acc.1 / n)
                out.data[o + 2] = UInt8(acc.2 / n)
                out.data[o + 3] = UInt8(acc.3 / n)
            }
        }
        return out
    }
    mutating func add(_ other: PixBuf, scale: Double) {
        for i in 0..<data.count {
            data[i] = UInt8(min(255, Int(data[i]) + Int((Double(other.data[i]) * scale).rounded())))
        }
    }
}
func ditherAreaImage(points: [ChartPoint], metric: ChartMetric, hidden: Set<String>, cols: Int, rows: Int) -> CGImage? {
    cachedImage("area:\(cols)x\(rows):\(metric.rawValue):\(hidden.sorted().joined(separator: ",")):\(pointsHash(points))") {
        renderDitherArea(points: points, metric: metric, hidden: hidden, cols: cols, rows: rows)
    }
}
func heatmapImage(columns: [[HeatCell]], cell: Int, gap: Int, today: String) -> CGImage? {
    cachedImage("heat:\(cell)/\(gap)/\(today)/\(heatHash(columns))") {
        renderHeatmap(columns: columns, cell: cell, gap: gap, today: today)
    }
}
private func paintColumn(_ buf: inout PixBuf, x: Int, top: Int, floor: Int, fill: RGB) {
    let t = top
    let f = floor
    let depth = f - t
    if depth <= 0 {
        buf.set(x, t, fill, alpha: BORDER_ALPHA)
        return
    }
    for y in t..<f {
        let density = 0.5 + 0.5 * (Double(y - t) / Double(depth))
        let lit = density > BAYER[y & 3][x & 3] - 0.2
        let k = 0.3 + density * 0.7
        buf.set(x, y, fill, alpha: lit ? k : k * OFF_TIER)
    }
    buf.set(x, t, fill, alpha: BORDER_ALPHA)
    if depth > 1 {
        buf.set(x, t + 1, fill, alpha: BORDER_ALPHA * 0.5)
    }
}
private func resample(_ src: [Double], cols: Int) -> [Double] {
    var out = [Double](repeating: 0, count: cols)
    let last = max(Double(src.count - 1), 1)
    for c in 0..<cols {
        let t = (Double(c) / max(Double(cols - 1), 1)) * last
        let i = Int(t)
        let f = t - Double(i)
        let a = src[i]
        let b = src[min(i + 1, src.count - 1)]
        out[c] = a + (b - a) * f
    }
    return out
}
struct ChartPoint: Equatable {
    let label: String
    let tick: String
    let agents: [AgentSplitDTO]
    func value(of metric: ChartMetric) -> Double {
        agents.reduce(0) { $0 + (metric == .tokens ? $1.tokens : $1.cost) }
    }
}
func renderDitherArea(
    points: [ChartPoint],
    metric: ChartMetric,
    hidden: Set<String>,
    cols: Int,
    rows: Int
) -> CGImage? {
    guard cols > 0, rows > 0, !points.isEmpty else { return nil }
    let n = points.count
    var totals: [String: Double] = [:]
    for point in points {
        for split in point.agents where !hidden.contains(split.agent) {
            totals[split.agent, default: 0] += metric == .tokens ? split.tokens : split.cost
        }
    }
    let agents = totals.keys.sorted { (totals[$0] ?? 0) > (totals[$1] ?? 0) }
    guard !agents.isEmpty else { return nil }
    let maxV = max(points.map { point in
        point.agents.reduce(0) { acc, split in
            hidden.contains(split.agent) ? acc : acc + (metric == .tokens ? split.tokens : split.cost)
        }
    }.max() ?? 0, 1e-9)
    let yOf = { (v: Double) in (1 - v / maxV) * Double(rows - 1) }
    var cumulative = [Double](repeating: 0, count: n)
    var tops: [[Double]] = []
    var floors: [[Double]] = []
    for agent in agents {
        var top = [Double](repeating: 0, count: n)
        var floor = [Double](repeating: 0, count: n)
        for (i, point) in points.enumerated() {
            floor[i] = yOf(cumulative[i])
            let split = point.agents.first(where: { $0.agent == agent })
            cumulative[i] += split.map { metric == .tokens ? $0.tokens : $0.cost } ?? 0
            top[i] = yOf(cumulative[i])
        }
        tops.append(resample(top, cols: cols))
        floors.append(resample(floor, cols: cols))
    }
    var buf = PixBuf(w: cols, h: rows)
    for s in 0..<agents.count {
        let fill = ditherFill(agents[s])
        for x in 0..<cols {
            let a = Int(tops[s][x].rounded())
            let b = Int(floors[s][x].rounded())
            paintColumn(&buf, x: x, top: min(a, b), floor: max(a, b), fill: fill)
        }
    }
    let glow = buf.blurred()
    buf.add(glow, scale: 0.4)
    return buf.image()
}
func renderDitherTile(color: RGB) -> CGImage? {
    var buf = PixBuf(w: 8, h: 8)
    for y in 0..<8 {
        for x in 0..<8 {
            if BAYER[y & 3][x & 3] <= 0.625 {
                buf.set(x, y, color, alpha: 1)
            }
        }
    }
    return buf.image()
}
let PROGRESS_EDGE = 28
func progressTipImage(color: RGB, h: Int) -> CGImage? {
    cachedImage("tip-\(h)-\(color.r)-\(color.g)-\(color.b)") {
        var buf = PixBuf(w: PROGRESS_EDGE, h: h)
        for x in 0..<PROGRESS_EDGE {
            let density = 1 - Double(x) / Double(PROGRESS_EDGE)
            for y in 0..<h where BAYER[y & 3][x & 3] < density {
                buf.set(x, y, color, alpha: 1)
            }
        }
        return buf.image()
    }
}
func progressBandImage(color: RGB, w: Int, h: Int) -> CGImage? {
    cachedImage("band-\(w)-\(h)-\(color.r)-\(color.g)-\(color.b)") {
        var buf = PixBuf(w: w, h: h)
        for x in 0..<w {
            let density = min(min(1, Double(x) / Double(PROGRESS_EDGE)), Double(w - x) / Double(PROGRESS_EDGE))
            for y in 0..<h where BAYER[y & 3][x & 3] < density {
                buf.set(x, y, color, alpha: min(1, density * 1.4))
            }
        }
        return buf.image()
    }
}
private let RAMP: [Int: RGB] = [
    0: (92, 92, 100),
    1: (255, 90, 20),
    2: (255, 115, 10),
    3: (255, 140, 20),
    4: (255, 170, 45),
    5: (255, 205, 110),
]
func heatLevel(_ value: Double, max maxV: Double) -> Int {
    guard value > 0, maxV > 0 else { return 0 }
    let t = value / maxV
    if t < 0.02 { return 1 }
    if t < 0.12 { return 2 }
    if t < 0.3 { return 3 }
    if t < 0.55 { return 4 }
    return 5
}
struct HeatCell: Equatable {
    let date: String
    let level: Int
    let cost: Double
    let tokens: Double
}
func renderHeatmap(
    columns: [[HeatCell]],
    cell: Int,
    gap: Int,
    today: String
) -> CGImage? {
    let cols = columns.count
    guard cols > 0 else { return nil }
    let w = cols * cell + (cols - 1) * gap
    let h = 7 * cell + 6 * gap
    guard w > 0, h > 0 else { return nil }
    var buf = PixBuf(w: w, h: h)
    for (ci, col) in columns.enumerated() {
        for (ri, cellData) in col.enumerated() {
            if cellData.level < 0 { continue }
            let x0 = ci * (cell + gap)
            let y0 = ri * (cell + gap)
            let fill = RAMP[cellData.level] ?? RAMP[0]!
            for dy in 0..<cell {
                for dx in 0..<cell {
                    buf.set(x0 + dx, y0 + dy, fill, alpha: cellAlpha(cellData.level, x0 + dx, y0 + dy))
                }
            }
            if cellData.date == today {
                let white: RGB = (255, 255, 255)
                for dx in 0..<cell {
                    buf.set(x0 + dx, y0, white, alpha: 0.55)
                    buf.set(x0 + dx, y0 + cell - 1, white, alpha: 0.55)
                }
                for dy in 0..<cell {
                    buf.set(x0, y0 + dy, white, alpha: 0.55)
                    buf.set(x0 + cell - 1, y0 + dy, white, alpha: 0.55)
                }
            }
        }
    }
    return buf.image()
}
func renderSwatch(level: Int, size: Int) -> CGImage? {
    var buf = PixBuf(w: size, h: size)
    let fill = RAMP[level] ?? RAMP[0]!
    for y in 0..<size {
        for x in 0..<size {
            buf.set(x, y, fill, alpha: cellAlpha(level, x, y))
        }
    }
    return buf.image()
}
struct MouseTrack: NSViewRepresentable {
    var move: (NSPoint, TrackNSView) -> Void
    var exit: (TrackNSView) -> Void
    func makeNSView(context: Context) -> TrackNSView {
        let view = TrackNSView()
        view.move = move
        view.exit = exit
        return view
    }
    func updateNSView(_ view: TrackNSView, context: Context) {
        view.move = move
        view.exit = exit
    }
    @MainActor
    final class TrackNSView: NSView {
        var move: (NSPoint, TrackNSView) -> Void = { _, _ in }
        var exit: (TrackNSView) -> Void = { _ in }
        private var timer: Timer?
        private var inside = false
        private let lineLayer = CALayer()
        private let dotLayer = CALayer()
        private let ringLayer = CALayer()
        private var tipView: NSView?
        private var tipKey = ""
        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)
            wantsLayer = true
            lineLayer.backgroundColor = NSColor.white.withAlphaComponent(0.14).cgColor
            dotLayer.backgroundColor = NSColor.white.withAlphaComponent(0.9).cgColor
            dotLayer.cornerRadius = 2
            ringLayer.borderColor = NSColor.white.withAlphaComponent(0.6).cgColor
            ringLayer.borderWidth = 1
            ringLayer.cornerRadius = 3
            for l in [lineLayer, dotLayer, ringLayer] {
                l.isHidden = true
                layer?.addSublayer(l)
            }
        }
        required init?(coder: NSCoder) { fatalError() }
        override var isFlipped: Bool { true }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            timer?.invalidate()
            timer = nil
            if window != nil {
                let t = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.poll() }
                }
                RunLoop.main.add(t, forMode: .common)
                timer = t
            }
        }
        private func poll() {
            guard let window, window.isVisible else {
                if inside {
                    inside = false
                    exit(self)
                }
                return
            }
            let p = convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
            let nowInside = bounds.contains(p)
            if nowInside { move(p, self) }
            if nowInside != inside {
                inside = nowInside
                if !inside { exit(self) }
            }
        }
        func showMarker(x: CGFloat, dotY: CGFloat) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            lineLayer.frame = CGRect(x: x - 0.5, y: 0, width: 1, height: bounds.height)
            dotLayer.frame = CGRect(x: x - 2, y: dotY - 2, width: 4, height: 4)
            lineLayer.isHidden = false
            dotLayer.isHidden = false
            ringLayer.isHidden = true
            CATransaction.commit()
        }
        func showRing(center: CGPoint, size: CGFloat) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            ringLayer.frame = CGRect(x: center.x - size / 2, y: center.y - size / 2, width: size, height: size)
            ringLayer.isHidden = false
            lineLayer.isHidden = true
            dotLayer.isHidden = true
            CATransaction.commit()
        }
        func setTip(key: String, build: () -> NSView) {
            guard key != tipKey else { return }
            tipKey = key
            tipView?.removeFromSuperview()
            let v = build()
            tipView = v
            addSubview(v)
        }
        func moveTip(centerX: CGFloat, centerY: CGFloat) {
            guard let tipView else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            tipView.setFrameOrigin(NSPoint(x: centerX - tipView.bounds.width / 2, y: centerY - tipView.bounds.height / 2))
            CATransaction.commit()
        }
        func hideHover() {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            lineLayer.isHidden = true
            dotLayer.isHidden = true
            ringLayer.isHidden = true
            CATransaction.commit()
            tipKey = ""
            tipView?.removeFromSuperview()
            tipView = nil
        }
        isolated deinit { timer?.invalidate() }
    }
}
private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
func makeTipView(title: String, rows: [(dot: NSColor?, left: String, right: String)], empty: String? = nil) -> NSView {
    let font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
    let attrs: [NSAttributedString.Key: Any] = [.font: font]
    func label(_ s: String, _ color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: s)
        f.font = font
        f.textColor = color
        f.lineBreakMode = .byClipping
        f.sizeToFit()
        return f
    }
    var subviews: [(view: NSView, x: CGFloat, y: CGFloat)] = []
    var y: CGFloat = 6
    let titleField = label(title, .tertiaryLabelColor)
    subviews.append((titleField, 9, y))
    y += titleField.bounds.height + 3
    var innerW = titleField.bounds.width
    for r in rows {
        let dotW: CGFloat = r.dot == nil ? 0 : 13
        let lw = (r.left as NSString).size(withAttributes: attrs).width
        let rw = (r.right as NSString).size(withAttributes: attrs).width
        let w = dotW + lw + (r.right.isEmpty ? 0 : 10 + rw)
        innerW = max(innerW, w)
    }
    let showEmpty = rows.isEmpty ? empty : nil
    if let showEmpty {
        innerW = max(innerW, (showEmpty as NSString).size(withAttributes: attrs).width)
    }
    for r in rows {
        var x: CGFloat = 9
        var rowH: CGFloat = 0
        if let c = r.dot {
            let d = NSView(frame: NSRect(x: x, y: y + 1, width: 7, height: 7))
            d.wantsLayer = true
            d.layer?.backgroundColor = c.cgColor
            d.layer?.cornerRadius = 1.5
            subviews.append((d, x, y))
            x += 13
        }
        let lf = label(r.left, .secondaryLabelColor)
        subviews.append((lf, x, y))
        rowH = max(rowH, lf.bounds.height)
        if !r.right.isEmpty {
            let rf = label(r.right, .labelColor)
            subviews.append((rf, 9 + innerW - rf.bounds.width, y))
            rowH = max(rowH, rf.bounds.height)
        }
        y += max(rowH, 7) + 3
    }
    if let showEmpty {
        let ef = label(showEmpty, .quaternaryLabelColor)
        subviews.append((ef, 9, y))
        y += ef.bounds.height + 3
    }
    let container = FlippedView(frame: NSRect(x: 0, y: 0, width: innerW + 18, height: y + 3))
    container.wantsLayer = true
    container.layer?.backgroundColor = NSColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1).cgColor
    container.layer?.cornerRadius = 7
    container.layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
    container.layer?.borderWidth = 0.5
    for s in subviews {
        s.view.frame.origin = CGPoint(x: s.x, y: s.y)
        container.addSubview(s.view)
    }
    return container
}
struct DitherAreaChart: View, Equatable {
    let points: [ChartPoint]
    let metric: ChartMetric
    let hidden: Set<String>
    let maxV: Double
    nonisolated static func == (l: Self, r: Self) -> Bool {
        l.points == r.points && l.metric == r.metric && l.hidden == r.hidden && l.maxV == r.maxV
    }
    var body: some View {
        GeometryReader { geo in
            let cols = max(8, Int(geo.size.width / 2))
            let rows = max(8, Int(geo.size.height / 2))
            if let image = ditherAreaImage(points: points, metric: metric, hidden: hidden, cols: cols, rows: rows) {
                ZStack {
                    gridLines
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.none)
                    MouseTrack(
                        move: { point, view in
                            guard !points.isEmpty else { return }
                            let n = max(points.count - 1, 1)
                            let hi = min(max(Int(((point.x / geo.size.width) * Double(n)).rounded()), 0), points.count - 1)
                            let v = points[hi].agents.reduce(0.0) {
                                hidden.contains($1.agent) ? $0 : $0 + metric.value(for: $1)
                            }
                            let topY = geo.size.height * (1 - (maxV > 0 ? v / maxV : 0))
                            let x = points.count > 1
                                ? geo.size.width * CGFloat(hi) / CGFloat(points.count - 1)
                                : geo.size.width / 2
                            view.showMarker(x: x, dotY: topY)
                            view.setTip(key: "chart\(hi)") {
                                makeTipView(
                                    title: points[hi].label,
                                    rows: points[hi].agents
                                        .filter { !hidden.contains($0.agent) && metric.value(for: $0) > 0 }
                                        .sorted { metric.value(for: $0) > metric.value(for: $1) }
                                        .map { s in
                                            let rgb = ditherFill(s.agent)
                                            return (
                                                NSColor(red: CGFloat(rgb.r) / 255, green: CGFloat(rgb.g) / 255, blue: CGFloat(rgb.b) / 255, alpha: 1),
                                                s.agent,
                                                metric == .cost ? formatMoney(s.cost) : "\(formatCompactTokens(s.tokens)) tok"
                                            )
                                        },
                                    empty: "no usage"
                                )
                            }
                            view.moveTip(centerX: min(max(point.x, 70), geo.size.width - 70), centerY: max(topY - 14, 24))
                        },
                        exit: { view in view.hideHover() }
                    )
                }
            }
        }
    }
    private var gridLines: some View {
        GeometryReader { geo in
            Path { path in
                for i in 1...3 {
                    let y = geo.size.height * Double(i) / 4
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geo.size.width, y: y))
                }
            }
            .stroke(Color.primary.opacity(0.12), style: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
        }
        .allowsHitTesting(false)
    }
}
struct DitherTile: View, Equatable {
    let color: RGB
    nonisolated static func == (l: Self, r: Self) -> Bool {
        l.color.r == r.color.r && l.color.g == r.color.g && l.color.b == r.color.b
    }
    var body: some View {
        if let image = cachedImage("tile:\(color.r),\(color.g),\(color.b)", { renderDitherTile(color: color) }) {
            Image(decorative: image, scale: 0.5)
                .resizable(resizingMode: .tile)
                .interpolation(.none)
        }
    }
}
struct HatchFill: View, Equatable {
    let color: RGB
    nonisolated static func == (l: Self, r: Self) -> Bool {
        l.color.r == r.color.r && l.color.g == r.color.g && l.color.b == r.color.b
    }
    var body: some View {
        Canvas { ctx, size in
            let c = Color(
                red: Double(color.r) / 255,
                green: Double(color.g) / 255,
                blue: Double(color.b) / 255
            ).opacity(0.28)
            var path = Path()
            var x = -size.height
            while x < size.width + size.height {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += 3
            }
            ctx.stroke(path, with: .color(c), lineWidth: 1)
        }
    }
}
