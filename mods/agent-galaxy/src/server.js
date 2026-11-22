#!/usr/bin/env node
/*
 * Agent Galaxy: live view of a Claude Code session.
 *
 *   node agent-galaxy.js                  show the most recently active sessions, one galaxy each
 *   node agent-galaxy.js --project api    only sessions whose project folder name contains "api"
 *   node agent-galaxy.js --sessions 12    how many recent sessions to show (default 8)
 *   node agent-galaxy.js --days 30        how far back a session may have been active (default 7)
 *   node agent-galaxy.js --all            also show old sessions and finished scheduled tasks
 *   node agent-galaxy.js --port 5000 --no-open
 *   node agent-galaxy.js --list           print the transcripts it found and which ones it shows, then exit
 *   node agent-galaxy.js --inspect 91daf1 show the shape of one transcript's first messages, then exit
 *   node agent-galaxy.js --root <dir>     read project folders from <dir> instead of ~/.claude/projects
 *
 * Reads the session transcripts Claude Code writes under ~/.claude/projects, plus the names and first lines of each
 * session's CLAUDE.md, rule, skill and memory files (all read-only),
 * and serves the page on 127.0.0.1 only. No dependencies.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { exec } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const PORT = Number(opt('port', 4777));
const FILTER = String(opt('project', '') === true ? '' : opt('project', '')).toLowerCase();
const CONFIG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const ROOT = typeof opt('root', '') === 'string' && opt('root', '') ? path.resolve(String(opt('root', ''))) : path.join(CONFIG, 'projects');
const PAGE = __PAGE__;
const BUILD = require('crypto').createHash('sha1').update(PAGE).digest('hex').slice(0, 10);   // lets an open page notice a newer script

const RINGS = ['Tools', 'Files', 'Actions', 'Thoughts'];
const CAPS = { Tools: 8, Files: 10, Actions: 8, Thoughts: 8 };
const CONTEXT_CAP = 22;
// how many key ideas to show: [per file, per kind]
const IDEAS = { claude: [6, 8], memory: [3, 5], rule: [2, 4] };
const TAIL_BYTES = 4 * 1024 * 1024;
const MAX = Math.max(1, Math.min(24, Number(opt('sessions', 8)) || 8));
const ALL = args.includes('--all');
const DAYS = Math.max(0.05, Number(opt('days', 7)) || 7), WINDOW_MS = DAYS * 86400000, SCHEDULED_MS = 3600000;

const tracked = new Map();   // transcript path -> session
const clients = new Set();

const NO_PROMPT = 'Waiting for the first prompt';
function makeSession(file, mtime) {
  const dir = path.basename(path.dirname(file));
  const S = { file, id: path.basename(file, '.jsonl'), project: dir.split('-').filter(Boolean).pop() || dir, core: NO_PROMPT,
    rings: {}, pos: 0, rest: Buffer.alloc(0), mtime, seq: 0, pending: [], dirty: false, cwd: '', title: '', context: [], hits: new Map(), subs: new Map(), subAt: 0, subSig: '', status: 'working', toolOf: new Map(), todos: [], taskSeq: 0, ctx: 0, out: 0, outBy: new Map(), model: '' };
  for (const r of RINGS) S.rings[r] = new Map();
  return S;
}
const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
const flat = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Items keep their first-seen order (so words don't shuffle around the ring); the least recently touched one is evicted.
function touch(S, ring, key, text, detail, pulse) {
  const m = S.rings[ring]; let it = m.get(key);
  if (!it) { it = { key, n: 0 }; m.set(key, it); }
  it.n++; it.at = ++S.seq;
  it.text = typeof text === 'function' ? text(it.n) : text;
  it.detail = clip(flat((typeof detail === 'function' ? detail(it.n) : detail) || it.text), 400);
  while (m.size > CAPS[ring]) { let old = null; for (const v of m.values()) if (!old || v.at < old.at) old = v; m.delete(old.key); }
  S.dirty = true;
  if (pulse) S.pending.push({ ring, key });
}

function toolLabel(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1].replace(/[_-]+/g, ' ')}: ${m[2].replace(/_/g, ' ')}` : name;
}
function describe(name, input) {
  const i = input || {}, base = p => path.basename(String(p));
  switch (name) {
    case 'Bash': return [flat(i.description || i.command), flat(i.command)];
    case 'Read': return ['read ' + base(i.file_path), i.file_path];
    case 'Edit': case 'MultiEdit': return ['edit ' + base(i.file_path), i.file_path];
    case 'Write': return ['write ' + base(i.file_path), i.file_path];
    case 'NotebookEdit': return ['edit ' + base(i.notebook_path), i.notebook_path];
    case 'Grep': return [`grep "${flat(i.pattern)}"`, `grep "${flat(i.pattern)}"${i.path ? ' in ' + i.path : ''}`];
    case 'Glob': return ['find ' + flat(i.pattern), null];
    case 'WebSearch': return ['search: ' + flat(i.query), null];
    case 'WebFetch': { let h = flat(i.url); try { h = new URL(i.url).hostname; } catch (e) {} return ['fetch ' + h, i.url]; }
    case 'Task': case 'Agent': return ['agent: ' + flat(i.description || i.subagent_type || 'subtask'), flat(i.prompt)];
    case 'TaskCreate': return ['todo: ' + flat(i.subject || i.description), flat(i.description)];
    case 'TaskUpdate': return [i.status ? `todo #${i.taskId}: ${String(i.status).replace('_', ' ')}` : null, null];
    case 'TodoWrite': { const t = (i.todos || []).find(x => x.status === 'in_progress'); return t ? ['todo: ' + flat(t.activeForm || t.content), null] : [null, null]; }
    default: { const v = Object.values(i).find(x => typeof x === 'string' && x.trim()); const m = /^mcp__.+?__(.+)$/.exec(name); return [(m ? m[1].replace(/_/g, ' ') : name) + (v ? ': ' + flat(v) : ''), null]; }
  }
}
function firstSentence(text) {
  const t = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>_]+/g, '');
  for (const part of t.split(/(?<=[.!?。！？])\s+|\n+/)) { const s = flat(part); if (s.length > 3) return s; }
  return '';
}

/* ---------- context: what the agent was given before it started ---------- */
function entries(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; } }
function isFile(f) { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }
function headOf(file, n) { try { return fs.readFileSync(file, 'utf8').slice(0, n || 3000); } catch (e) { return ''; } }
const clipWord = (s, n) => { if (s.length <= n) return s; const cut = s.slice(0, n), sp = cut.lastIndexOf(' '); return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(]+$/, '') + '…'; };
// A short label for one instruction: its lead-in clause when it has one, otherwise its opening words.
function shorten(text) {
  const lead = /^(.{12,48}?)(?::\s|\s[—–-]\s|\.\s|;\s)/.exec(text + ' ');
  return lead ? lead[1] : clipWord(text, 46);
}
// The key ideas of an instructions file: its bullet points, or its sentences when it has no bullets.
function keyIdeas(file, max) {
  const t = headOf(file, 40000).replace(/^---[\s\S]*?\n---/, '').replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const clean = x => flat(x.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]+/g, '').replace(/^\s*\[[a-z ]{2,12}\]\s*/i, ''));
  const bullets = [], paras = [], heads = [];
  for (const line of t.split('\n')) {
    let m;
    if ((m = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line))) bullets.push(clean(m[1]));
    else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) heads.push(clean(m[1]));
    else if (/^[^\s|>]/.test(line)) paras.push(...clean(line).split(/(?<=[.!?。！？])\s+/));
  }
  let src = bullets.filter(x => x.length > 8);
  if (src.length < 2) src = src.concat(paras.filter(x => x.length > 8));
  if (!src.length) src = heads.filter(x => x.length > 3);
  const out = [], seen = new Set();
  for (const full of src) { const short = shorten(full); if (seen.has(short)) continue; seen.add(short); out.push({ short, full }); if (out.length >= max) break; }
  return out;
}
function summary(file) {
  const t = headOf(file), d = /^description:\s*(.+)$/m.exec(t);
  if (d) return flat(d[1].replace(/^["']|["']$/g, ''));
  for (const line of t.replace(/^---[\s\S]*?\n---/, '').split('\n')) { const x = flat(line.replace(/^[#>*\-\s]+/, '')); if (x.length > 3) return x; }
  return '';
}
// CLAUDE.md files, memory files, rules and skills for a session's project. Returns true when the list changed.
function scanContext(S) {
  const items = [], seen = new Set();
  const add = (key, text, file, skill) => { if (seen.has(key)) return; seen.add(key); items.push({ key, text, file: file || '', base: file ? clip(file + (summary(file) ? ' · ' + summary(file) : ''), 300) : text, skill: skill || '' }); };
  // an instructions file becomes its key ideas, one planet each; the file name alone says nothing
  const count = { claude: 0, memory: 0, rule: 0 };
  const md = (file, label, kind = 'claude') => {
    if (!isFile(file) || seen.has(file)) return;
    const [perFile, total] = IDEAS[kind];
    if (count[kind] >= total) return;
    const ideas = keyIdeas(file, Math.min(perFile, total - count[kind]));
    if (!ideas.length) return add(file, label, file);
    seen.add(file);
    for (const idea of ideas) {
      const key = file + '#' + idea.short;
      if (seen.has(key)) continue; seen.add(key); count[kind]++;
      items.push({ key, text: idea.short, file, base: clip(idea.full, 320) + ' · from ' + label + ' (' + file + ')', skill: '' });
    }
  };
  if (S.cwd) {
    let d = S.cwd;
    for (let i = 0; i < 6; i++) {
      const scope = i === 0 ? 'project' : path.basename(d) || 'root';
      md(path.join(d, 'CLAUDE.md'), 'CLAUDE.md · ' + scope);
      md(path.join(d, '.claude', 'CLAUDE.md'), 'CLAUDE.md · ' + scope);
      md(path.join(d, 'CLAUDE.local.md'), 'CLAUDE.local.md · ' + scope);
      const up = path.dirname(d); if (up === d || d === os.homedir()) break; d = up;
    }
  }
  md(path.join(CONFIG, 'CLAUDE.md'), 'CLAUDE.md · user');
  const memDir = path.join(path.dirname(S.file), 'memory');
  for (const e of entries(memDir)) if (e.isFile() && e.name.endsWith('.md')) md(path.join(memDir, e.name), 'memory: ' + e.name.replace(/\.md$/, ''), 'memory');
  for (const base of [S.cwd && path.join(S.cwd, '.claude', 'rules'), path.join(CONFIG, 'rules')]) {
    if (!base) continue;
    for (const e of entries(base)) {
      if (e.isFile() && e.name.endsWith('.md')) md(path.join(base, e.name), 'rule: ' + e.name.replace(/\.md$/, ''), 'rule');
      else if (e.isDirectory()) for (const f of entries(path.join(base, e.name))) if (f.isFile() && f.name.endsWith('.md')) md(path.join(base, e.name, f.name), 'rule: ' + f.name.replace(/\.md$/, ''), 'rule');
    }
  }
  // skills the agent actually used come first, so they are never cut by the cap
  const used = [...S.hits.keys()].filter(k => k.startsWith('skill:')).map(k => k.slice(6)), skills = [];
  for (const base of [S.cwd && path.join(S.cwd, '.claude', 'skills'), path.join(CONFIG, 'skills')]) {
    if (!base) continue;
    for (const e of entries(base)) { const f = path.join(base, e.name, 'SKILL.md'); if (e.isDirectory() && isFile(f)) skills.push({ name: e.name, file: f }); }
  }
  skills.sort((a, b) => used.includes(b.name) - used.includes(a.name));
  for (const k of skills) add(k.file, 'skill: ' + k.name, k.file, k.name);
  for (const name of used) if (!skills.some(k => k.name === name)) add('skill:' + name, 'skill: ' + name, '', name);
  const next = items.slice(0, CONTEXT_CAP), sig = x => x.map(i => i.key + '|' + i.text).join('\n');
  const changed = sig(next) !== sig(S.context);
  S.context = next;
  if (changed) S.dirty = true;
  return changed;
}
const contextKeys = (S, key) => S.context.filter(i => i.key === key || i.file === key || (key.startsWith('skill:') && i.skill === key.slice(6))).map(i => i.key);
function hit(S, key, pulse) {
  const fresh = !S.hits.has(key);
  S.hits.set(key, (S.hits.get(key) || 0) + 1);
  if (!pulse) return;
  if (fresh && key.startsWith('skill:')) scanContext(S);
  for (const k of contextKeys(S, key)) { S.pending.push({ ring: 'Context', key: k }); S.dirty = true; }
}

/* ---------- the agent's own to-do list ---------- */
// Two shapes exist: TodoWrite sends the whole list each time; TaskCreate / TaskUpdate change one task at a time.
const todoState = x => x === 'completed' ? 'done' : x === 'in_progress' ? 'doing' : 'todo';
function todoTool(S, b) {
  const i = b.input || {};
  if (b.name === 'TodoWrite' && Array.isArray(i.todos)) {
    S.todos = i.todos.map(t => ({ id: '', text: flat(t.content || t.subject), active: flat(t.activeForm), state: todoState(t.status) }));
  } else if (b.name === 'TaskCreate' && (i.subject || i.description)) {
    S.todos.push({ id: '', pending: b.id, text: flat(i.subject || i.description), active: flat(i.activeForm), state: 'todo' });
  } else if (b.name === 'TaskUpdate' && i.taskId != null) {
    const t = S.todos.find(x => x.id === String(i.taskId));
    if (!t) return;
    if (i.status === 'deleted') S.todos = S.todos.filter(x => x !== t);
    else { if (i.status) t.state = todoState(i.status); if (i.subject) t.text = flat(i.subject); if (i.activeForm) t.active = flat(i.activeForm); }
  } else return;
  S.dirty = true;
}
// TaskCreate's result carries the new task's id; fall back to counting when it cannot be read.
function todoResult(S, b) {
  const t = S.todos.find(x => x.pending === b.tool_use_id);
  if (!t) return;
  const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => (x && x.text) || '').join(' ') : '';
  const m = /(?:#|\bid["'\s:=]+|\btask\s+)(\d+)/i.exec(text);
  S.taskSeq = m ? Math.max(S.taskSeq, Number(m[1])) : S.taskSeq + 1;
  t.id = m ? m[1] : String(S.taskSeq); delete t.pending;
}

// A tool call came back as an error (it failed, or the user declined it).
function markError(S, id, pulse) {
  const act = S.rings.Actions.get(id), name = S.toolOf.get(id), tool = name && S.rings.Tools.get(name);
  if (act) act.error = true;
  if (tool) tool.fails = (tool.fails || 0) + 1;
  S.dirty = true;
  if (!pulse) return;
  if (act) S.pending.push({ ring: 'Actions', key: id, error: true });
  if (tool) S.pending.push({ ring: 'Tools', key: name, error: true });
}
function setStatus(S, status) { if (S.status !== status) { S.status = status; S.dirty = true; } }

// What the user actually asked, from a user message's text; '' when the message is not a request.
// Editors and the CLI wrap extra material in tags around (or instead of) the prompt.
const NOISE_TAGS = 'system-reminder|ide_opened_file|ide_selection|ide_diagnostics|local-command-stdout|local-command-stderr|local-command-caveat|command-message|command-stdout|command-stderr|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|task-notification';
const NOISE_RE = new RegExp('<(' + NOISE_TAGS + ')\\b[^>]*>[\\s\\S]*?</\\1>', 'g');
function promptText(raw, o) {
  let text = String(raw);
  // a compaction summary is written as a user message, but it is not something the user asked
  if ((o && o.isCompactSummary) || /^\s*This session is being continued from a previous conversation/i.test(text)) return '';
  // a scheduled task's prompt is boilerplate around the task; its name says what it is
  const sched = /^\s*<scheduled-task\b[^>]*\bname="([^"]+)"/.exec(text);
  if (sched) return 'Scheduled task: ' + flat(sched[1]);
  const cmd = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(text);
  if (cmd) {   // a slash command: show it as "/name args"; housekeeping commands are not a task
    const cmdArgs = /<command-args>([\s\S]*?)<\/command-args>/.exec(text);
    text = flat(cmd[1] + ' ' + (cmdArgs ? cmdArgs[1] : ''));
    return /^\/(clear|exit|quit|help|status|config|model|compact|resume|login|logout|cost|doctor|plugin|mcp|memory|permissions)\b/.test(text) ? '' : text;
  }
  text = flat(text.replace(NOISE_RE, ' '));
  if (text.startsWith('<')) text = flat(text.replace(/<\/?[A-Za-z][\w:.-]*(\s[^<>]*)?>/g, ' '));   // a prompt written inside tags of its own
  return /^(Caveat:|\[Request interrupted)/.test(text) ? '' : text;
}

function handle(S, o, pulse) {
  // a session's title, used when no prompt can be read from it
  if (o && typeof o === 'object' && !o.message) {
    const title = (o.type === 'summary' && o.summary) || ((o.type === 'custom-title' || o.type === 'ai-title') && (o.customTitle || o.aiTitle || o.title));
    if (title && typeof title === 'string' && flat(title) !== S.title) { S.title = flat(title); S.dirty = true; }
  }
  if (!o || typeof o !== 'object' || !o.message) return;
  if (o.cwd && !S.cwd) { S.cwd = String(o.cwd); S.cwdChanged = true; const p = path.basename(S.cwd); if (p && p !== S.project) { S.project = p; S.dirty = true; } }
  const c = o.message.content, id = o.uuid || String(S.seq);
  if (o.type === 'user') {
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') { setStatus(S, 'working'); todoResult(S, b); if (b.is_error) markError(S, b.tool_use_id, pulse); }
    if (o.isMeta || o.isSidechain) return;
    let text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '';
    text = promptText(text, o);
    if (!text) return;
    if (S.core === NO_PROMPT && text.startsWith('Scheduled task: ')) S.scheduled = true;   // started by a schedule, not by a person
    S.core = clip(text, 120); S.dirty = true; setStatus(S, 'working');
  } else if (o.type === 'assistant' && Array.isArray(c)) {
    c.forEach((b, i) => {
      if (!b) return;
      if (b.type === 'tool_use' && b.name) {
        if (b.id) { S.toolOf.set(b.id, b.name); if (S.toolOf.size > 600) S.toolOf.delete(S.toolOf.keys().next().value); }
        if (!o.isSidechain) todoTool(S, b);   // a subagent's own to-do list is not the session's
        const label = toolLabel(b.name);
        touch(S, 'Tools', b.name, n => n > 1 ? `${label} ×${n}` : label, n => `${label}, used ${n} time${n > 1 ? 's' : ''}`, pulse);
        const fp = b.input && (b.input.file_path || b.input.notebook_path);
        if (fp) { touch(S, 'Files', String(fp), path.basename(String(fp)), String(fp), pulse); hit(S, String(fp), pulse); }
        if (b.name === 'Skill' && b.input && b.input.skill) hit(S, 'skill:' + String(b.input.skill).split(':').pop(), pulse);
        const [short, full] = describe(b.name, b.input);
        if (short) touch(S, 'Actions', b.id || id + ':' + i, clip(short, 44), full || short, pulse);
      } else if ((b.type === 'thinking' && b.thinking) || (b.type === 'text' && b.text)) {
        const raw = b.thinking || b.text, s = firstSentence(raw);
        if (s) touch(S, 'Thoughts', id + ':' + i, clip(s, 46), raw, pulse);
      }
    });
    // token use: the latest request's input is the context in use; output is summed once per message
    const u = o.message.usage;
    if (u && !o.isSidechain) {
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx && ctx !== S.ctx) { S.ctx = ctx; S.dirty = true; }
      const mid = o.message.id || id, prev = S.outBy.get(mid) || 0, out = u.output_tokens || 0;
      if (out > prev) { S.out += out - prev; S.outBy.set(mid, out); S.dirty = true; }
      if (o.message.model) S.model = String(o.message.model);
    }
    // working while tools are in flight; a reply with no tool call means the turn is over and it is the user's move
    if (!o.isSidechain) {
      const stop = o.message.stop_reason, tool = c.some(b => b && b.type === 'tool_use'), text = c.some(b => b && b.type === 'text' && b.text);
      if (tool || stop === 'tool_use') setStatus(S, 'working');
      else if (stop === 'end_turn' || stop === 'stop_sequence' || (text && !stop)) setStatus(S, 'waiting');
    }
  }
}

function snapshot(S) {
  return { id: S.id, project: S.project, core: S.core === NO_PROMPT && S.title ? clip(S.title, 120) : S.core,
    mtime: Math.max(S.mtime, S.subAt), status: Date.now() - S.subAt < SUB_RUNNING_MS ? 'working' : S.scheduled && S.status === 'waiting' ? 'done' : S.status, usage: { ctx: S.ctx, out: S.out, model: S.model },
    todos: S.todos.slice(0, 40).map(t => ({ t: clip(t.state === 'doing' && t.active ? t.active : t.text, 60), s: t.state })),
    rings: RINGS.map(name => ({ name, items: [...S.rings[name].values()].map(({ key, text, detail, n, error, fails }) => ({ key, text, n, error: !!error,
      detail: detail + (error ? ' · failed or declined' : '') + (fails ? ` · ${fails} failed or declined` : '') })) })).concat([agentsRing(S), { name: 'Context',
      items: S.context.map(i => { const uses = (i.file ? S.hits.get(i.file) || 0 : 0) + (i.skill ? S.hits.get('skill:' + i.skill) || 0 : 0);
        return { key: i.key, text: i.text, detail: i.base + (uses ? ` · used ${uses} time${uses > 1 ? 's' : ''} this session` : ' · available, not opened in this session'), n: uses + 1, idle: !uses }; }) }]) };
}
function send(obj) { const msg = 'data: ' + JSON.stringify(obj) + '\n\n'; for (const res of clients) res.write(msg); }
const full = () => ({ build: BUILD, full: [...tracked.values()].sort((a, b) => b.mtime - a.mtime).map(snapshot) });
function flush(S, extra) { send(Object.assign({ id: S.id, state: snapshot(S), pulses: S.pending }, extra)); S.pending = []; S.dirty = false; }

/* ---------- subagents ---------- */
// A session's subagents write their own transcripts to <project>/<session id>/subagents/agent-*.jsonl, and the
// session's own transcript can sit untouched for days while they work. Their steps are fed into the session's
// rings, and each subagent is an item on the Agents ring.
const SUB_RUNNING_MS = 60000, SUB_SHOWN = 8;
const subDir = S => path.join(path.dirname(S.file), S.id, 'subagents');
function pollSubs(S, pulse) {
  const dir = subDir(S); let files = [];
  for (const e of entries(dir)) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    try { const st = fs.statSync(path.join(dir, e.name)); files.push({ name: e.name, size: st.size, mtime: st.mtimeMs }); } catch (err) {}
  }
  if (!files.length && !S.subs.size) return;
  files.sort((a, b) => b.mtime - a.mtime);
  // first look: only the most recent ones, read from near their end; afterwards, anything new is read in full
  if (!pulse) files = files.slice(0, SUB_SHOWN);
  for (const f of files) {
    let sub = S.subs.get(f.name);
    if (!sub) {
      if (pulse && S.subs.size && f.mtime < S.subAt - 86400000) continue;
      sub = { name: f.name, pos: pulse ? 0 : Math.max(0, f.size - 512 * 1024), skip: !pulse && f.size > 512 * 1024, rest: Buffer.alloc(0), prompt: '', kind: '', steps: 0, last: '', mtime: 0, seen: ++S.seq };
      S.subs.set(f.name, sub);
      if (sub.pos > 0) sub.prompt = subPrompt(path.join(dir, f.name));
    }
    sub.mtime = f.mtime; if (f.mtime > S.subAt) S.subAt = f.mtime;
    if (f.size < sub.pos) { sub.pos = 0; sub.rest = Buffer.alloc(0); }
    if (f.size === sub.pos) continue;
    let buf; try { buf = readRange(path.join(dir, f.name), sub.pos, f.size); } catch (err) { continue; }
    sub.pos = f.size;
    const data = sub.rest.length ? Buffer.concat([sub.rest, buf]) : buf, end = data.lastIndexOf(10);
    if (end < 0) { sub.rest = data; continue; }
    sub.rest = data.subarray(end + 1);
    let text = data.subarray(0, end).toString('utf8');
    if (sub.skip) { text = text.slice(text.indexOf('\n') + 1); sub.skip = false; }   // started mid-line
    for (const ln of text.split('\n')) {
      if (!ln.trim()) continue;
      let o; try { o = JSON.parse(ln); } catch (err) { continue; }
      if (!o || typeof o !== 'object' || !o.message) continue;
      o.isSidechain = true;
      const c = o.message.content;
      if (o.type === 'user' && !sub.prompt) sub.prompt = clip(flat(typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : ''), 300);
      if (o.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use') { sub.steps++; const d = describe(b.name, b.input)[0]; if (d) sub.last = clip(d, 60); }
      if (o.agentType || o.subagent_type) sub.kind = String(o.agentType || o.subagent_type);
      handle(S, o, pulse);
    }
    S.dirty = true;
    if (pulse) S.pending.push({ ring: 'Agents', key: sub.name });
  }
  const sig = agentsRing(S).items.map(i => i.key + (i.idle ? '-' : '+') + i.n).join(',');
  if (sig !== S.subSig) { S.subSig = sig; S.dirty = true; }
}
function subPrompt(file) {   // the task a subagent was given: its first user message
  for (const ln of headOf(file, 60000).split('\n')) {
    let o; try { o = JSON.parse(ln); } catch (e) { continue; }
    if (!o || o.type !== 'user' || !o.message) continue;
    const c = o.message.content, t = flat(typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '');
    if (t) return clip(t, 300);
  }
  return '';
}
function agentsRing(S) {
  const now = Date.now(), shown = [...S.subs.values()].sort((a, b) => b.mtime - a.mtime).slice(0, SUB_SHOWN).sort((a, b) => a.seen - b.seen);
  return { name: 'Agents', items: shown.map(a => {
    const running = now - a.mtime < SUB_RUNNING_MS, label = a.prompt ? shorten(a.prompt) : (a.kind || 'subagent');
    return { key: a.name, text: clip(label, 44), n: 1 + Math.min(8, Math.floor(a.steps / 4)), idle: !running,
      detail: clip((a.kind ? a.kind + ' · ' : '') + (a.prompt || 'subagent'), 300) + ` · ${a.steps} step${a.steps === 1 ? '' : 's'}${a.last ? ', last: ' + a.last : ''} · ${running ? 'running' : 'finished'}` };
  }) };
}
// Newest subagent activity per session file, refreshed now and then: it decides which sessions count as recent.
const subMtime = new Map();
function refreshSubMtimes() {
  subMtime.clear();
  let dirs; try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (e) { return; }
  for (const d of dirs) {
    if (!d.isDirectory() || (FILTER && !d.name.toLowerCase().includes(FILTER))) continue;
    for (const e of entries(path.join(ROOT, d.name))) {
      if (!e.isDirectory()) continue;
      const sd = path.join(ROOT, d.name, e.name, 'subagents'); let newest = 0;
      for (const f of entries(sd)) { if (!f.isFile()) continue; try { newest = Math.max(newest, fs.statSync(path.join(sd, f.name)).mtimeMs); } catch (err) {} }
      if (newest) subMtime.set(path.join(ROOT, d.name, e.name + '.jsonl'), newest);
    }
  }
}

/* ---------- following the transcripts ---------- */
// A project folder also holds transcripts that are not sessions of their own: subagent runs (every line is a
// sidechain line, or the file is named agent-*) and files with no messages at all. Showing those as galaxies
// crowds out the real sessions, so they are left out. A transcript with messages but no prompt from the user
// ("unprompted") is only shown when there is room.
const kinds = new Map();
function kindOf(file, size) {
  const c = kinds.get(file);
  if (c && ((c.kind !== 'empty' && c.kind !== 'unprompted') || c.size === size)) return c.kind;
  let kind = 'session';
  try {
    const n = Math.min(size, 262144);
    let msgs = 0, side = 0; const T = makeSession(file, 0);
    for (const ln of readRange(file, 0, n).toString('utf8').split('\n')) {
      if (!ln.trim()) continue;
      let o; try { o = JSON.parse(ln); } catch (e) { continue; }
      if (!o || !o.message || (o.type !== 'user' && o.type !== 'assistant')) continue;
      msgs++; if (o.isSidechain) side++;
      handle(T, o, false);
    }
    if (path.basename(file).startsWith('agent-') || (msgs > 0 && side === msgs)) kind = 'subagent';
    else if (msgs === 0 && n === size) kind = 'empty';
    else if (T.scheduled) kind = 'scheduled';
    else if (T.core === NO_PROMPT && n === size) kind = 'unprompted';
  } catch (e) {}
  kinds.set(file, { kind, size });
  return kind;
}
function candidates() {
  const out = []; let dirs;
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory() || (FILTER && !d.name.toLowerCase().includes(FILTER))) continue;
    let files; try { files = fs.readdirSync(path.join(ROOT, d.name)); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(ROOT, d.name, f);
      try { const st = fs.statSync(file); if (st.size > 0) out.push({ file, mtime: Math.max(st.mtimeMs, subMtime.get(file) || 0), own: st.mtimeMs, size: st.size }); } catch (e) {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
// Which transcripts become galaxies, and for the rest, why not.
//   - a session active within the last --days days (default 7)
//   - a scheduled-task session only while it is running, or within the hour after: finished automation is clutter
//   - an unprompted transcript only when there is room
//   - if that leaves nothing, the three most recent sessions whatever their age
// --all drops the age and scheduled-task rules.
function choose() {
  const now = Date.now(), all = candidates().slice(0, 300), why = new Map(), out = [], spare = [], old = [];
  for (const c of all) {
    const kind = kindOf(c.file, c.size); c.kind = kind;
    if (kind === 'subagent' || kind === 'empty') { why.set(c.file, 'skipped'); continue; }
    if (kind === 'unprompted') { spare.push(c); continue; }
    if (!ALL && kind === 'scheduled' && now - c.mtime > SCHEDULED_MS) { why.set(c.file, 'finished'); continue; }
    if (!ALL && now - c.mtime > WINDOW_MS) { why.set(c.file, 'too old'); old.push(c); continue; }
    if (out.length < MAX) out.push(c); else why.set(c.file, 'over ' + MAX);
  }
  if (!out.length) for (const c of old.filter(x => x.kind === 'session').slice(0, 3)) { out.push(c); why.delete(c.file); }
  for (const c of spare) { if (out.length < MAX) out.push(c); else why.set(c.file, 'no room'); }
  return { all, why, shown: out.sort((x, y) => y.mtime - x.mtime) };
}
const recent = () => choose().shown;
// --list: what the script sees under the projects folder, to explain what is and is not shown
function listSessions() {
  refreshSubMtimes();
  const picked = choose(), all = picked.all, now = Date.now();
  const age = ms => { const m = Math.round((now - ms) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
  console.log(`${all.length} transcript files under ${ROOT}${FILTER ? ' matching "' + FILTER + '"' : ''}.`);
  const by = new Map();
  for (const c of all) { const d = path.basename(path.dirname(c.file)), p = by.get(d) || { n: 0, newest: 0 }; p.n++; p.newest = Math.max(p.newest, c.mtime); by.set(d, p); }
  console.log('\nProject folders, most recently active first:');
  for (const [d, p] of [...by].sort((x, y) => y[1].newest - x[1].newest).slice(0, 30)) console.log(`  ${age(p.newest).padStart(6)} ago  ${String(p.n).padStart(4)} files  ${d}`);
  if (all.length && now - all[0].mtime > 3600000) console.log(`\nNothing here has changed in the last hour. Sessions running right now are being written somewhere else (see README, "Which sessions are shown").`);
  console.log(`\nShown: sessions active in the last ${DAYS} days, at most ${MAX}; scheduled tasks only within an hour of running.${ALL ? ' (--all: no age or scheduled-task limit)' : ' Use --days N, --sessions N or --all to change that.'}`);
  console.log('\nThe 40 most recent transcripts:\n');
  for (const c of all.slice(0, 40)) {
    const kind = c.kind, S = kind === 'session' || kind === 'scheduled' ? load(c.file, c.mtime) : null;
    const mark = (picked.why.get(c.file) || 'SHOWN').padEnd(8);
    console.log(`${mark}  ${kind.padEnd(10)}  ${age(c.mtime).padStart(6)} ago  ${String(Math.round(c.size / 1024)).padStart(6)} KB  ${(S ? S.project : path.basename(path.dirname(c.file))).slice(0, 22).padEnd(22)}  ${path.basename(c.file).slice(0, 13)}  ${S ? snapshot(S).status.padEnd(7) + '  ' + clip(S.core, 50) : ''}${c.mtime > c.own ? '  [subagents active ' + age(c.mtime) + ' ago]' : ''}`);
  }
}

function feed(S, buf, pulse) {
  const data = S.rest.length ? Buffer.concat([S.rest, buf]) : buf;
  const end = data.lastIndexOf(10);
  if (end < 0) { S.rest = data; return; }
  S.rest = data.subarray(end + 1);
  for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try { handle(S, JSON.parse(line), pulse); } catch (e) {}
  }
}
function readRange(file, from, to) {
  const buf = Buffer.alloc(to - from), fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  return buf;
}
function load(file, mtime) {
  const S = makeSession(file, mtime);
  try {
    const size = fs.statSync(file).size, from = Math.max(0, size - TAIL_BYTES);
    let buf = readRange(file, from, size);
    if (from > 0) buf = buf.subarray(buf.indexOf(10) + 1);
    feed(S, buf, false); S.pos = size;
  } catch (e) {}
  pollSubs(S, false);
  scanContext(S); S.cwdChanged = false;
  S.pending = []; S.dirty = false;
  return S;
}
function poll() {
  for (const S of tracked.values()) {
    let s; try { s = fs.statSync(S.file); } catch (e) { continue; }
    if (s.size < S.pos) { tracked.set(S.file, load(S.file, s.mtimeMs)); flush(tracked.get(S.file), { reset: true }); continue; }
    if (s.size > S.pos) {
      try { feed(S, readRange(S.file, S.pos, s.size), true); S.pos = s.size; S.mtime = s.mtimeMs; S.dirty = true; } catch (e) {}
      if (S.cwdChanged) { scanContext(S); S.cwdChanged = false; }
      if (S.dirty) flush(S);
    }
  }
}
function scan() {
  const list = recent(), keep = new Set(list.map(x => x.file)); let changed = false;
  for (const file of [...tracked.keys()]) if (!keep.has(file)) { tracked.delete(file); changed = true; }
  for (const x of list) if (!tracked.has(x.file)) { tracked.set(x.file, load(x.file, x.mtime)); changed = true; console.log('Following ' + x.file); }
  if (changed) send(full());
}

/* ---------- replay ---------- */
// Re-reads a transcript from the start and records the galaxy after every line that changed it.
function buildReplay(file, max) {
  const S = makeSession(file, 0), frames = [];
  let text = '';
  try {
    const size = fs.statSync(file).size, from = Math.max(0, size - 2 * TAIL_BYTES);
    let buf = readRange(file, from, size);
    if (from > 0) buf = buf.subarray(buf.indexOf(10) + 1);
    text = buf.toString('utf8');
  } catch (e) {}
  for (const ln of text.split('\n')) {
    if (!ln.trim()) continue;
    let o; try { o = JSON.parse(ln); } catch (e) { continue; }
    handle(S, o, true);
    if (S.cwdChanged) { scanContext(S); S.cwdChanged = false; }
    if (!S.dirty) continue;
    const t = Date.parse(o && o.timestamp) || 0;
    if (t) S.mtime = t;
    frames.push({ t, state: snapshot(S), pulses: S.pending });
    S.pending = []; S.dirty = false;
  }
  return { id: S.id, project: S.project, frames: frames.slice(-(max || 300)) };
}
// For a page that will be shared: home folders become "~" so user names and machine paths are not published.
function redact(json) {
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), home = JSON.stringify(os.homedir()).slice(1, -1);
  return json.replace(new RegExp(esc(home), 'g'), '~').replace(/(?:\/(?:Users|home)\/|[A-Za-z]:\\\\Users\\\\)[^\/\\"\s]+/g, '~');
}
function exportPage(data) {
  const json = redact(JSON.stringify(data)).replace(/</g, '\\u003c');
  return PAGE.replace('<script>', () => '<script>window.__REPLAY__ = ' + json + ';</script>\n<script>');
}

/* ---------- server ---------- */
function start() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(PAGE);
    } else if (url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify(full()) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
    } else if (url === '/replay' || url === '/export') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const S = [...tracked.values()].find(x => x.id === id);
    if (!S) { res.writeHead(404); return res.end('Unknown session'); }
    const data = buildReplay(S.file);
    if (url === '/replay') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(data)); }
    const name = 'agent-galaxy-' + String(data.project || 'session').replace(/[^A-Za-z0-9._-]+/g, '-') + '.html';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.end(exportPage(data));
  } else { res.writeHead(404); res.end('Not found'); }
  });
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Try: node ${path.basename(process.argv[1])} --port ${PORT + 1}` : e.message);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Agent Galaxy is running at ${url}`);
    console.log(`Watching ${ROOT}${FILTER ? ' (projects matching "' + FILTER + '")' : ''}`);
    refreshSubMtimes(); scan();
    if (!tracked.size) console.log('No session transcripts found yet. Start Claude Code and this will pick it up.');
    setInterval(poll, 300); setInterval(scan, 2000);
    setInterval(() => { for (const S of tracked.values()) { pollSubs(S, true); if (S.dirty) flush(S); } }, 1000);
    setInterval(refreshSubMtimes, 10000);
    setInterval(() => { for (const S of tracked.values()) if (scanContext(S)) flush(S); }, 10000);
    setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
    if (!args.includes('--no-open')) {
      const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

// --inspect <start of a session id>: the shape of a transcript's first messages, to see why no prompt was read
function inspect(prefix) {
  const c = candidates().find(x => path.basename(x.file).startsWith(prefix));
  if (!c) return console.log('No transcript whose name starts with "' + prefix + '" under ' + ROOT);
  console.log(c.file + '\n');
  const text = readRange(c.file, 0, Math.min(c.size, 2 * 1024 * 1024)).toString('utf8'), types = new Map();
  let shown = 0;
  for (const ln of text.split('\n')) {
    if (!ln.trim()) continue;
    let o; try { o = JSON.parse(ln); } catch (e) { continue; }
    types.set(o.type, (types.get(o.type) || 0) + 1);
    if (o.type !== 'user' || !o.message || shown >= 8) continue;
    const ct = o.message.content, kinds = typeof ct === 'string' ? 'string' : Array.isArray(ct) ? ct.map(b => b && b.type).join('+') : typeof ct;
    if (/tool_result/.test(kinds)) continue;
    const raw = typeof ct === 'string' ? ct : Array.isArray(ct) ? ct.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '';
    shown++;
    console.log(`user message ${shown}: content=${kinds} isMeta=${!!o.isMeta} isSidechain=${!!o.isSidechain} keys=${Object.keys(o).filter(k => k !== 'message').join(',')}`);
    console.log('  starts: ' + JSON.stringify(flat(raw).slice(0, 100)));
    console.log('  read as: ' + JSON.stringify(o.isMeta || o.isSidechain ? '' : clip(promptText(raw, o), 80)) + '\n');
  }
  console.log('line types in the first 2 MB: ' + [...types].map(([k, v]) => k + '×' + v).join(', '));
}

// Run as a script, or load it from a test to use the parser on its own.
if (require.main === module) { if (args.includes('--inspect')) inspect(String(opt('inspect', ''))); else if (args.includes('--list')) listSessions(); else start(); }
else module.exports = { makeSession, snapshot, scanContext, keyIdeas, shorten, buildReplay, redact, exportPage, kindOf, promptText, pollSubs, feedText: (S, text, pulse) => feed(S, Buffer.from(text.endsWith('\n') ? text : text + '\n'), pulse) };
