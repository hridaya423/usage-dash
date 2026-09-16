#!/bin/bash
set -uo pipefail

export PATH="$HOME/.bun/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG="${MACHINES_CONFIG:-$DIR/machines.config.json}"
PUB_FILE="${1:-$HOME/.ssh/id_ed25519.pub}"
VERSION_ARGS="ccusage@20.0.20 --version"

if [ ! -f "$PUB_FILE" ]; then
  echo "no public key at $PUB_FILE — pass one: bash scripts/authorize.sh <key.pub>" >&2
  exit 1
fi
PUB="$(cat "$PUB_FILE")"

bun "$DIR/scripts/machines.ts" --config "$CFG" | \
while IFS='|' read -r id ssh shell mode bun repo key; do
  [ -z "$id" ] && continue
  echo "== $id ($ssh)"
  KEY_ARGS=()
  [ -n "$key" ] && KEY_ARGS=(-i "$key")

  ssh-keyscan -T 5 "${ssh##*@}" >> ~/.ssh/known_hosts 2>/dev/null

  if [ "$shell" = "powershell" ]; then
    ssh ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o ConnectTimeout=10 "$ssh" powershell -NoProfile -NonInteractive - <<PS
\$pub = '$PUB'
\$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
\$target = if (\$isAdmin) { 'C:\ProgramData\ssh\administrators_authorized_keys' } else { "\$env:USERPROFILE\.ssh\authorized_keys" }
New-Item -ItemType Directory -Force (Split-Path \$target) | Out-Null
if (!(Test-Path \$target) -or !(Select-String -Path \$target -SimpleMatch \$pub -Quiet)) { Add-Content \$target \$pub }
if (\$isAdmin) { icacls \$target /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null }
Write-Output "authorized in \$target"
PS
  else
    ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o ConnectTimeout=10 "$ssh" \
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qF '$PUB' ~/.ssh/authorized_keys || echo '$PUB' >> ~/.ssh/authorized_keys) && echo authorized"
  fi

  if [ "$mode" = "envelope" ]; then
    ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=8 "$ssh" \
      "test -f $repo/scripts/fetch-all.sh && echo 'envelope ok: repo present' || echo 'MISSING: clone usage-dash to $repo on $id'"
  elif [ "$shell" = "powershell" ]; then
    ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=8 "$ssh" "& $bun $VERSION_ARGS"
  else
    ssh -n ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} -o BatchMode=yes -o ConnectTimeout=8 "$ssh" \
      "export PATH=\"\$HOME/.bun/bin:\$PATH\"; ${bun:-bunx} $VERSION_ARGS"
  fi
done

sort -u ~/.ssh/known_hosts -o ~/.ssh/known_hosts 2>/dev/null || true
