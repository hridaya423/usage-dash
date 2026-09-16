#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || {
  echo "bun is required — install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
}

bun install

[ -f machines.config.json ] || printf '{\n  "localId": "hub",\n  "machines": []\n}\n' > machines.config.json

bun run build

cat <<'EOF'

Done. You can:

  bun start                          dashboard on your LAN → http://<lan-ip>:3200

  $EDITOR machines.config.json       add machines (see the example entries)
  bash scripts/authorize.sh        install your SSH key on them (one-time)
  bash scripts/install-service.sh  keep the dashboard running at login
  bash menubar/build.sh            menubar app — run on the Mac you'll watch from
EOF
