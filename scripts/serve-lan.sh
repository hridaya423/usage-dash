#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3200}"
HOST="${HOST:-$(/usr/sbin/ipconfig getifaddr "$(/sbin/route -n get default | awk '/interface:/{print $2}')" 2>/dev/null || true)}"
NODE="${NODE:-$(command -v node || command -v bun)}"

[ -n "$HOST" ] || { echo "no LAN address found — set HOST=… and retry" >&2; exit 1; }
[ -n "$NODE" ] || { echo "node or bun required" >&2; exit 1; }

exec "$NODE" "$DIR/node_modules/next/dist/bin/next" start -p "$PORT" -H "$HOST"
