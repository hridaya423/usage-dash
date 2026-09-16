import SwiftUI
struct SettingsView: View {
    @EnvironmentObject private var store: UsageStore
    let done: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Settings")
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Button("Done", action: done)
                    .keyboardShortcut(.escape)
                    .keyboardShortcut(.return)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("MENU BAR SHOWS")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .tracking(0.4)
                Picker("", selection: $store.labelPreset) {
                    ForEach(LabelPreset.allCases, id: \.self) { preset in
                        Text(preset.title).tag(preset)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("REFRESH EVERY")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .tracking(0.4)
                Picker("", selection: $store.pollSeconds) {
                    Text("30s").tag(30.0)
                    Text("1m").tag(60.0)
                    Text("2m").tag(120.0)
                    Text("5m").tag(300.0)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("SERVER URL")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .tracking(0.4)
                TextField("http://localhost:3200", text: $store.baseURL)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11).monospaced())
            }
            Text("Launches at login via launchd.")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 12)
    }
}
