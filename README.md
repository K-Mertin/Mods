# Mods

Claude Code mods: function-hook plugins that add panes, bands above the prompt, status line entries, toasts, slash commands, and tool/prompt hooks. This repository is also a plugin marketplace (`.claude-plugin/marketplace.json`).

## Layout

```
.claude-plugin/marketplace.json   lists every mod in mods/
mods/<name>/
  .claude-plugin/plugin.json      manifest
  hooks/hooks.json                { "modules": ["./register.ts"] }
  hooks/register.ts(x)            export const register: Register = (on, options) => { ... }
  types/index.d.ts                (optional) $.state contract, named in plugin.json "types"
  tests/*.test.ts                 run by `claude plugin test`
templates/mod/                    what scripts/new-mod.sh copies
scripts/new-mod.sh <name> [desc]  scaffold a mod and add it to the marketplace
scripts/check.sh [name...]        validate + test all mods (or the ones named)
```

## Develop

```bash
scripts/new-mod.sh my-mod "What it does"
```

```bash
claude --plugin-dir ./mods/my-mod
```

Saving a file in a `--plugin-dir` folder hot-reloads the mod in an interactive session. For desktop app sessions, list the mod folders in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

Alternatively, install from this folder as a local marketplace. Edits are then picked up with `/reload-plugins` without reinstalling:

```bash
claude plugin marketplace add /path/to/Mods
```

```bash
claude plugin install hello@k-mertin-mods
```

On first load the engine writes `.claude-plugin/types/` and a `tsconfig.json` into each mod, so `tsc -p mods/<name>` type-checks it. The generated types folder is gitignored.

## Check

```bash
scripts/check.sh
```

Set `CLAUDE_BIN` if the `claude` on your PATH is older than the build you develop against (`plugin validate`/`plugin test` and the hooks API move between releases).

## Install (for others)

After pushing to GitHub:

```
/plugin install <mod> --marketplace <owner>/<repo>
```

## Mods

| Mod | What it does |
| --- | --- |
| [hello](mods/hello) | `/hello [name]` command and a tool-call counter in the status line |
| [rts](mods/rts) | `/rts` opens a live pixel-art map of every session on this machine: agents, model/effort, tokens, cost, task progress, shells, who needs you, and messages. `/rts demo` shows sample data |
