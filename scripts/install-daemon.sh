#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${LABEL:-local.usage-dash}"
USER_NAME="$(id -un)"
PLIST="$DIR/$LABEL.daemon.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>UserName</key>
  <string>$USER_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/scripts/serve-lan.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PORT</key>
    <string>${PORT:-3200}</string>
    <key>PATH</key>
    <string>$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/usage-dash.out.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/usage-dash.err.log</string>
</dict>
</plist>
EOF

cat <<EOF
staged → $PLIST

install it (asks for your sudo password):

  sudo cp "$PLIST" "/Library/LaunchDaemons/$LABEL.plist" && \\
  sudo launchctl bootstrap system "/Library/LaunchDaemons/$LABEL.plist"

uninstall:

  sudo launchctl bootout "system/$LABEL" && sudo rm "/Library/LaunchDaemons/$LABEL.plist"
EOF
