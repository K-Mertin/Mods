# Agent Galaxy

A live 3D view of Claude Code sessions in the browser. Each session is a galaxy: the latest prompt is the core, and what the agent does orbits it.

This is a standalone script, **not a mod**: it has no `plugin.json` and is not listed in the marketplace.

## Run

```bash
node mods/agent-galaxy/agent-galaxy.js
```

It opens `http://localhost:4777`. Needs Node; no other dependencies.

| Option | What it does |
| --- | --- |
| `--project <name>` | Only sessions whose project folder name contains `<name>` |
| `--sessions <n>` | How many recent sessions to show (default 8) |
| `--port <n>` | Port to serve on (default 4777) |
| `--no-open` | Do not open the browser |

## What you see

| Ring | Content |
| --- | --- |
| Tools | Each tool the agent used, with a count |
| Files | Files it read or edited |
| Actions | Its recent steps: commands, searches, edits |
| Thoughts | The first sentence of its recent reasoning and replies |
| Context | Key ideas from `CLAUDE.md`, memory and rule files, plus available skills |

- Every new step fires a pulse from the core to the matching item.
- An item is a small planet: it grows and gains moons the more it is used. Context items the agent has not opened are dimmed.
- The session menu switches sessions; **All sessions** (or Esc) shows every recent session as its own galaxy.
- Click an item for its full text.
- A step that failed or was declined turns its planet red, and the pulse that reports it is red too.
- The agent's to-do list is a segmented arc around the core: bright for done, pulsing for in progress, faint for still to do, with the current task named underneath.
- The core shows the session's state: amber while the agent works, blue with **YOUR TURN** when it has finished and is waiting for you, dim with **QUIET** after a minute without activity.

## What it reads

Read-only, on your machine only (the page is served on `127.0.0.1`):

- session transcripts under `~/.claude/projects`
- the names and first lines of each session's `CLAUDE.md`, rule, skill and memory files

## Develop

The page is embedded in `agent-galaxy.js` as one string, so edit the sources and rebuild:

```bash
node mods/agent-galaxy/build.js
```

- `src/server.js`: follows the transcripts and serves the page and its event stream
- `src/page.html`, `src/page.js`: the page

An open page reloads itself when the script restarts with a newer build.
