#!/bin/bash
set -o pipefail

export PATH="$HOME/.bun/bin:$PATH"

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECTIONS="daily,weekly,monthly,session"
ARGS="ccusage@20.0.20 daily --sections $SECTIONS --by-agent --json"
CCUSAGE_CFG="$DIR/ccusage.json"
MACHINES_CFG="${MACHINES_CONFIG:-$DIR/machines.config.json}"

TMP_LOCAL=$(mktemp)
TMP_DEVIN=$(mktemp)
SRC_FILES=()
SRC_IDS=()
SRC_PIDS=()
trap 'rm -f "$TMP_LOCAL" "$TMP_DEVIN" "${SRC_FILES[@]:-}"' EXIT

bunx ccusage daily --sections "$SECTIONS" --by-agent --json --config "$CCUSAGE_CFG" \
  > "$TMP_LOCAL" 2>/dev/null &
LOCAL_PID=$!

bun "$DIR/scripts/fetch-devin.ts" > "$TMP_DEVIN" 2>/dev/null &
DEVIN_PID=$!

LOCAL_ID="${LOCAL_ID:-$(bun "$DIR/scripts/machines.ts" --config "$MACHINES_CFG" --local-id 2>/dev/null)}"
LOCAL_ID="${LOCAL_ID:-local}"

if [ "${SKIP_REMOTE:-0}" != "1" ]; then
  while IFS='|' read -r id ssh shell mode bun repo key; do
    [ -z "$id" ] && continue
    tmp=$(mktemp)
    SRC_FILES+=("$tmp")
    SRC_IDS+=("$id")
    KEY_ARGS=()
    [ -n "$key" ] && KEY_ARGS=(-i "$key")
    if [ "$mode" = "envelope" ]; then
      ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=5 "$ssh" \
        "SKIP_REMOTE=1 LOCAL_ID=$id bash $repo/scripts/fetch-all.sh" \
        > "$tmp" 2>/dev/null &
    elif [ "$shell" = "powershell" ]; then
      ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=10 "$ssh" \
        "& $bun $ARGS" > "$tmp" 2>/dev/null &
    else
      ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=10 "$ssh" \
        "export PATH=\"\$HOME/.bun/bin:\$PATH\"; ${bun:-bunx} $ARGS" \
        > "$tmp" 2>/dev/null &
    fi
    SRC_PIDS+=($!)
  done < <(bun "$DIR/scripts/machines.ts" --config "$MACHINES_CFG" 2>/dev/null)
fi

wait "$LOCAL_PID"; LOCAL_STATUS=$?
wait "$DEVIN_PID"; DEVIN_STATUS=$?

MERGE_SRC=()
for i in "${!SRC_PIDS[@]}"; do
  if wait "${SRC_PIDS[$i]}"; then
    MERGE_SRC+=("--src" "${SRC_IDS[$i]}=${SRC_FILES[$i]}")
  fi
done

if [ "$LOCAL_STATUS" -ne 0 ] && [ "$DEVIN_STATUS" -ne 0 ] && [ "${#MERGE_SRC[@]}" -eq 0 ]; then
  echo "all sources failed (local=$LOCAL_STATUS devin=$DEVIN_STATUS remotes=none-ok)" >&2
  exit 1
fi

CCUSAGE_MERGE=1 bun "$DIR/scripts/merge-usage.ts" \
  --local-id "$LOCAL_ID" --local "$TMP_LOCAL" --devin "$TMP_DEVIN" "${MERGE_SRC[@]}"
