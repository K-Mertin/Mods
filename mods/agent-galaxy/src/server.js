#!/usr/bin/env node
/*
 * Agent Galaxy: live view of a Claude Code session.
 *
 *   node agent-galaxy.js                  show the most recently active sessions, one galaxy each
 *   node agent-galaxy.js --project api    only sessions whose project folder name contains "api"
 *   node agent-galaxy.js --sessions 12    how many recent sessions to show (default 8)
 *   node agent-galaxy.js --port 5000 --no-open
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
const ROOT = path.join(CONFIG, 'projects');
const PAGE = __PAGE__;
const BUILD = require('crypto').createHash('sha1').update(PAGE).digest('hex').slice(0, 10);   // lets an open page notice a newer script

const RINGS = ['Tools', 'Files', 'Actions', 'Thoughts'];
const CAPS = { Tools: 8, Files: 10, Actions: 8, Thoughts: 8 };
const CONTEXT_CAP = 22;
// how many key ideas to show: [per file, per kind]
const IDEAS = { claude: [6, 8], memory: [3, 5], rule: [2, 4] };
const TAIL_BYTES = 4 * 1024 * 1024;
const MAX = Math.max(1, Math.min(24, Number(opt('sessions', 8)) || 8));

const tracked = new Map();   // transcript path -> session
const clients = new Set();

function makeSession(file, mtime) {
  const dir = path.basename(path.dirname(file));
  const S = { file, id: path.basename(file, '.jsonl'), project: dir.split('-').filter(Boolean).pop() || dir, core: 'Waiting for the first prompt',
    rings: {}, pos: 0, rest: Buffer.alloc(0), mtime, seq: 0, pending: [], dirty: false, cwd: '', context: [], hits: new Map(), status: 'working', toolOf: new Map() };
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
  if (src.length < 2) src = src.concat(paras.filter(x => x.length > 20));
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

function handle(S, o, pulse) {
  if (!o || typeof o !== 'object' || !o.message) return;
  if (o.cwd && String(o.cwd) !== S.cwd) { S.cwd = String(o.cwd); S.cwdChanged = true; const p = path.basename(S.cwd); if (p && p !== S.project) { S.project = p; S.dirty = true; } }
  const c = o.message.content, id = o.uuid || String(S.seq);
  if (o.type === 'user') {
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') { setStatus(S, 'working'); if (b.is_error) markError(S, b.tool_use_id, pulse); }
    if (o.isMeta || o.isSidechain) return;
    let text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '';
    text = flat(text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' '));
    if (!text || /^(<|Caveat:|\[Request interrupted)/.test(text)) return;
    S.core = clip(text, 120); S.dirty = true; setStatus(S, 'working');
  } else if (o.type === 'assistant' && Array.isArray(c)) {
    c.forEach((b, i) => {
      if (!b) return;
      if (b.type === 'tool_use' && b.name) {
        if (b.id) { S.toolOf.set(b.id, b.name); if (S.toolOf.size > 600) S.toolOf.delete(S.toolOf.keys().next().value); }
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
    // working while tools are in flight; a reply with no tool call means the turn is over and it is the user's move
    if (!o.isSidechain) {
      const stop = o.message.stop_reason, tool = c.some(b => b && b.type === 'tool_use'), text = c.some(b => b && b.type === 'text' && b.text);
      if (tool || stop === 'tool_use') setStatus(S, 'working');
      else if (stop === 'end_turn' || stop === 'stop_sequence' || (text && !stop)) setStatus(S, 'waiting');
    }
  }
}

function snapshot(S) {
  return { id: S.id, project: S.project, core: S.core, mtime: S.mtime, status: S.status,
    rings: RINGS.map(name => ({ name, items: [...S.rings[name].values()].map(({ key, text, detail, n, error, fails }) => ({ key, text, n, error: !!error,
      detail: detail + (error ? ' · failed or declined' : '') + (fails ? ` · ${fails} failed or declined` : '') })) })).concat([{ name: 'Context',
      items: S.context.map(i => { const uses = (i.file ? S.hits.get(i.file) || 0 : 0) + (i.skill ? S.hits.get('skill:' + i.skill) || 0 : 0);
        return { key: i.key, text: i.text, detail: i.base + (uses ? ` · used ${uses} time${uses > 1 ? 's' : ''} this session` : ' · available, not opened in this session'), n: uses + 1, idle: !uses }; }) }]) };
}
function send(obj) { const msg = 'data: ' + JSON.stringify(obj) + '\n\n'; for (const res of clients) res.write(msg); }
const full = () => ({ build: BUILD, full: [...tracked.values()].sort((a, b) => b.mtime - a.mtime).map(snapshot) });
function flush(S, extra) { send(Object.assign({ id: S.id, state: snapshot(S), pulses: S.pending }, extra)); S.pending = []; S.dirty = false; }

/* ---------- following the transcripts ---------- */
function recent() {
  const out = []; let dirs;
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory() || (FILTER && !d.name.toLowerCase().includes(FILTER))) continue;
    let files; try { files = fs.readdirSync(path.join(ROOT, d.name)); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(ROOT, d.name, f);
      try { const s = fs.statSync(file); if (s.size > 0) out.push({ file, mtime: s.mtimeMs }); } catch (e) {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, MAX);
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

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(PAGE);
  } else if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(full()) + '\n\n');
    clients.add(res); req.on('close', () => clients.delete(res));
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
  scan();
  if (!tracked.size) console.log('No session transcripts found yet. Start Claude Code and this will pick it up.');
  setInterval(poll, 300); setInterval(scan, 2000);
  setInterval(() => { for (const S of tracked.values()) if (scanContext(S)) flush(S); }, 10000);
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
