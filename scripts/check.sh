#!/usr/bin/env bash
# Validate and test every mod (or the ones named). Set CLAUDE_BIN to use a specific build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
claude="${CLAUDE_BIN:-claude}"
mods=("$@")
[[ ${#mods[@]} -eq 0 ]] && mods=($(ls "$root/mods"))

"$claude" plugin validate "$root"
for m in "${mods[@]}"; do
  echo "== $m"
  "$claude" plugin validate "$root/mods/$m"
  "$claude" plugin test "$root/mods/$m"
done
