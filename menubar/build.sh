#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

command -v swift >/dev/null || {
  echo "swift is required — install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
}

APP="$HOME/Applications/UsageBar.app"
BUNDLE_ID="${BUNDLE_ID:-com.usagebar.app}"
LABEL="$BUNDLE_ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

swift build -c release

mkdir -p "$APP/Contents/MacOS"
cp .build/release/UsageBar "$APP/Contents/MacOS/UsageBar"
sed "s/@BUNDLE_ID@/$BUNDLE_ID/" Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
codesign --force --sign - "$APP" >/dev/null

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$APP/Contents/MacOS/UsageBar</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed and running → $APP"
