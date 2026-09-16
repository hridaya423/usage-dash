import Foundation
func formatCompactTokens(_ tokens: Double) -> String {
    func trim(_ value: Double) -> String {
        let fixed = String(format: "%.1f", value)
        return fixed.hasSuffix(".0") ? String(fixed.dropLast(2)) : fixed
    }
    if tokens >= 1e9 { return "\(trim(tokens / 1e9))B" }
    if tokens >= 1e6 { return "\(trim(tokens / 1e6))M" }
    if tokens >= 1e3 { return "\(trim(tokens / 1e3))K" }
    return String(Int(tokens.rounded()))
}
func formatMoney(_ amount: Double) -> String {
    String(format: "$%.2f", amount)
}
func formatMoneyShort(_ amount: Double) -> String {
    if amount >= 1000 { return "$\(formatCompactTokens(amount))" }
    return formatMoney(amount)
}
func formatClock(_ date: Date) -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "HH:mm"
    return fmt.string(from: date)
}
func updatedAgo(_ date: Date) -> String {
    let seconds = max(0, Date().timeIntervalSince(date))
    if seconds < 60 { return "just now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
    return "\(Int(seconds / 86400))d ago"
}
func shortDay(_ iso: String) -> String {
    let parts = iso.split(separator: "-")
    guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else {
        return iso
    }
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    guard (1...12).contains(month) else { return iso }
    return "\(months[month - 1]) \(day)"
}
func formatPct(_ value: Double) -> String {
    String(format: "%.1f%%", value)
}
func fullDay(_ iso: String) -> String {
    let parts = iso.split(separator: "-")
    guard parts.count == 3,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
          let date = Calendar(identifier: .gregorian).date(from: DateComponents(year: year, month: month, day: day))
    else { return shortDay(iso) }
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US")
    fmt.dateFormat = "EEE, MMM d"
    return fmt.string(from: date)
}
