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
| `--list` | Print the transcripts found and which ones are shown, then exit |

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
- **Present** (or the P key) hides the controls, goes full screen and lets the camera drift; with several sessions it tours them, alternating with the view of all. Opening the page at `#present` starts that way, for a wall display.
- **Replay** steps through the session on screen from its start, with a timeline you can scrub and a speed control. **Save as page** downloads that replay as one HTML file that plays on its own, with no server.
- A step that failed or was declined turns its planet red, and the pulse that reports it is red too.
- The agent's to-do list is a segmented arc around the core: bright for done, pulsing for in progress, faint for still to do, with the current task named underneath.
- A gauge above the core shows how full the agent's context is (it turns red past 80%) and the output tokens so far. The limit is assumed to be 200K, or 1M once use passes 200K.
- The core shows the session's state: amber while the agent works, blue with **YOUR TURN** when it has finished and is waiting for you, dim with **QUIET** after a minute without activity.

## Sharing a saved replay

A saved page contains what the galaxy showed: prompts, commands, file names, the agent's replies, and key ideas from `CLAUDE.md`, memory and rule files. Home folders are rewritten to `~`, so your user name is not in the paths, but nothing else is removed. Read it before you share it.

A replay covers the last 300 changes of a session, read from the end of its transcript.

## Which sessions are shown

The most recently active sessions across all projects, eight by default. Transcripts that are not sessions of their own are left out: subagent runs, and files with no messages. A transcript with no prompt from you is shown only when there is room. `--list` prints what was found and why each one is shown or skipped.

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

An open page reloads itself when the script restarts with a newer build. When frames run slow the page draws fewer stars, and restores them when there is room.

Tests for the transcript parser (hand-written transcripts, not captures of real sessions):

```bash
node --test mods/agent-galaxy/test/*.test.js
```
