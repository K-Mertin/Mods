#!/usr/bin/env bash
# Scaffold a new mod from templates/mod and add it to the marketplace.
# Usage: scripts/new-mod.sh <name> ["one-line description"]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
name="${1:?usage: new-mod.sh <name> [description]}"
desc="${2:-A Claude Code mod}"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "name must be kebab-case" >&2; exit 1; }
dest="$root/mods/$name"
[[ -e "$dest" ]] && { echo "$dest already exists" >&2; exit 1; }

cp -R "$root/templates/mod" "$dest"
mv "$dest/tests/__NAME__.test.ts" "$dest/tests/$name.test.ts"
find "$dest" -type f -exec sed -i '' -e "s/__NAME__/$name/g" -e "s|__DESC__|$desc|g" {} +

python3 - "$root/.claude-plugin/marketplace.json" "$name" "$desc" <<'PY'
import json, sys
path, name, desc = sys.argv[1:]
data = json.load(open(path))
data["plugins"].append({"name": name, "source": f"./mods/{name}", "description": desc})
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
echo "Created mods/$name — run: claude --plugin-dir $dest"
