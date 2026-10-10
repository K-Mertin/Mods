# Mods repo

Claude Code mods (function-hook plugins). Each mod lives in `mods/<name>/` and must be listed in `.claude-plugin/marketplace.json`.

- Load the `plugin-authoring` skill before writing or debugging a mod: it points at this build's `claude-code.d.ts`, which is the authority on the API (early access, changes between releases). Grep it for the event or noun at hand instead of guessing.
- New mod: `scripts/new-mod.sh <name> "<description>"` (copies `templates/mod/`, adds the marketplace entry). Keep the template in step with what passes validation.
- Each mod is `.claude-plugin/plugin.json`, `hooks/hooks.json` (`{ "modules": ["./register.ts"] }`), `hooks/register.ts(x)`, and `tests/*.test.ts`. Mods that use `$.state` also need `types/index.d.ts` named in plugin.json `"types"`.
- No DOM, no Node, no `import()` in hook modules; `$` reaches everything outside. UI elements come from `$.ui.resolve(e)`.
- Never name a variable `h` in a `.tsx` file: JSX compiles to the global `h(...)`, so a local `h` (e.g. `hats.map(h => <Button/>)`) breaks every element drawn in its scope. Type-checking does not catch it; a `$.ui.mount` test does.
- Hooks on `tool.call` and other gating events need `.catch(...)`; validation warns otherwise.
- In tests, `$` is the engine itself: `$.command.run` takes the full `CommandRunInput` (with `origin` and `presentation`), not the plugin-side args.
- Test drawn UI with `$.ui.mount` on both `terminal` and `desktop` (see `mods/monster/tests/ui.test.tsx`); pure tests miss render-time crashes.
- Bump `version` in a mod's `plugin.json` for every release so `/plugin update` picks it up.
- Before calling a mod done: `scripts/check.sh <name>` (validate + test) and `tsc -p mods/<name>` once the engine has laid its types. The `claude` on PATH may be older than the running build; use `CLAUDE_BIN` to point at the current one.
- Update the Mods table in README.md when adding a mod.
