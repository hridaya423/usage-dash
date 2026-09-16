import SwiftUI
@main
struct UsageBarApp: App {
    @StateObject private var store = UsageStore()
    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(store)
                .frame(width: 380)
                .background(PopoverView.tint)
                .fixedSize(horizontal: true, vertical: true)
        } label: {
            LabelView()
                .environmentObject(store)
        }
        .menuBarExtraStyle(.window)
    }
}
private struct LabelView: View {
    @EnvironmentObject private var store: UsageStore
    var body: some View {
        HStack(spacing: 4) {
            Image(nsImage: store.iconImage)
            Text(store.labelText)
                .monospacedDigit()
        }
    }
}
