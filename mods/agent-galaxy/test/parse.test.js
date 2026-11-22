// Parser tests. The transcripts here are hand-written to match the shapes the parser expects;
// they are not captures of real sessions. Run: node --test mods/agent-galaxy/test/
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const G = require('../agent-galaxy.js');

const line = o => JSON.stringify(o);
const user = (content, extra) => line(Object.assign({ type: 'user', uuid: 'u' + Math.random(), message: { role: 'user', content } }, extra));
const asst = (content, msg, extra) => line(Object.assign({ type: 'assistant', uuid: 'a' + Math.random(), message: Object.assign({ role: 'assistant', content }, msg) }, extra));
const ring = (snap, name) => snap.rings.find(r => r.name === name).items;
function session(lines) {
  const S = G.makeSession(path.join(os.tmpdir(), 'agent-galaxy-test', 'proj', 's.jsonl'), 0);
  G.feedText(S, lines.join('\n'), true);
  return S;
}

test('the latest real prompt becomes the core', () => {
  const S = session([
    user('Deploy   the service', { cwd: '/tmp/demo-api' }),
    user('Caveat: local command output', { isMeta: true }),
    user('<command-name>/clear</command-name>'),
    user([{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }])
  ]);
  const snap = G.snapshot(S);
  assert.equal(snap.core, 'Deploy the service');
  assert.equal(snap.project, 'demo-api');
});

test('tool calls fill the Tools, Files and Actions rings', () => {
  const S = session([asst([
    { type: 'text', text: 'Reading the workflow first. Then the manifest.' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/demo-api/deploy.yml' } },
    { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/tmp/demo-api/k8s.yaml' } },
    { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'kubectl get pods', description: 'List pods' } },
    { type: 'tool_use', id: 't4', name: 'mcp__Slack__slack_search_public', input: { query: 'deploy' } }
  ])]);
  const snap = G.snapshot(S);
  assert.deepEqual(ring(snap, 'Tools').map(i => i.text), ['Read ×2', 'Bash', 'Slack: slack search public']);
  assert.deepEqual(ring(snap, 'Files').map(i => i.text), ['deploy.yml', 'k8s.yaml']);
  assert.deepEqual(ring(snap, 'Actions').map(i => i.text), ['read deploy.yml', 'read k8s.yaml', 'List pods', 'slack search public: deploy']);
  assert.equal(ring(snap, 'Thoughts')[0].text, 'Reading the workflow first.');
  assert.equal(ring(snap, 'Tools')[0].n, 2);
});

test('a failed tool result marks its action and counts on its tool', () => {
  const S = session([
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: '2 failed' }])
  ]);
  const snap = G.snapshot(S);
  assert.equal(ring(snap, 'Actions')[0].error, true);
  assert.match(ring(snap, 'Tools')[0].detail, /1 failed or declined/);
  assert.ok(S.pending.some(p => p.ring === 'Actions' && p.error));
});

test('state: working during tool use, waiting once a reply ends the turn', () => {
  const S = session([user('go'), asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }])]);
  assert.equal(G.snapshot(S).status, 'working');
  G.feedText(S, user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]), true);
  assert.equal(G.snapshot(S).status, 'working');
  G.feedText(S, asst([{ type: 'text', text: 'All done.' }], { stop_reason: 'end_turn' }), true);
  assert.equal(G.snapshot(S).status, 'waiting');
  G.feedText(S, user('next task'), true);
  assert.equal(G.snapshot(S).status, 'working');
});

test('to-do list from TodoWrite', () => {
  const S = session([asst([{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [
    { content: 'Bump the version', status: 'completed', activeForm: 'Bumping' },
    { content: 'Run the tests', status: 'in_progress', activeForm: 'Running the tests' },
    { content: 'Publish', status: 'pending', activeForm: 'Publishing' }] } }])]);
  assert.deepEqual(G.snapshot(S).todos, [{ t: 'Bump the version', s: 'done' }, { t: 'Running the tests', s: 'doing' }, { t: 'Publish', s: 'todo' }]);
});

test('to-do list from TaskCreate and TaskUpdate', () => {
  const S = session([
    asst([{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Find old logs', activeForm: 'Finding old logs' } },
          { type: 'tool_use', id: 'c2', name: 'TaskCreate', input: { subject: 'Archive them', activeForm: 'Archiving' } }]),
    user([{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #1 created successfully' },
          { type: 'tool_result', tool_use_id: 'c2', content: [{ type: 'text', text: 'Task #2 created successfully' }] }]),
    asst([{ type: 'tool_use', id: 'c3', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
          { type: 'tool_use', id: 'c4', name: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } }])
  ]);
  assert.deepEqual(G.snapshot(S).todos, [{ t: 'Find old logs', s: 'done' }, { t: 'Archiving', s: 'doing' }]);
});

test('token use: latest context, output summed once per message', () => {
  const S = session([
    asst([{ type: 'text', text: 'one' }], { id: 'm1', model: 'x', usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 90, output_tokens: 40 } }),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], { id: 'm1', usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 90, output_tokens: 120 } }),
    asst([{ type: 'text', text: 'two' }], { id: 'm2', usage: { input_tokens: 20, cache_read_input_tokens: 9000, output_tokens: 30 } })
  ]);
  const u = G.snapshot(S).usage;
  assert.equal(u.ctx, 9020);
  assert.equal(u.out, 150);
});

test('key ideas come from bullets, or sentences when there are none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-galaxy-'));
  const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md');
  fs.writeFileSync(a, '# Rules\n\n- Never name a variable `h` in a `.tsx` file: JSX compiles to h().\n- [stated] deploys go out on Tuesdays\n- **Use pnpm**, not npm, for everything in this repository and its tools\n');
  fs.writeFileSync(b, 'Prefer small diffs. Ask before deleting anything at all.\n');
  assert.deepEqual(G.keyIdeas(a, 6).map(i => i.short), ['Never name a variable h in a .tsx file', 'deploys go out on Tuesdays', 'Use pnpm, not npm, for everything in this…']);
  assert.deepEqual(G.keyIdeas(b, 6).map(i => i.short), ['Prefer small diffs', 'Ask before deleting anything at all']);
  fs.rmSync(dir, { recursive: true });
});

test('replay: one frame per change, in order, ending at the live state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-galaxy-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, [
    user('Ship it', { cwd: '/tmp/demo-api', timestamp: '2026-01-02T03:04:05Z' }),
    line({ type: 'file-history-snapshot', snapshot: {} }),
    asst([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }], {}, { timestamp: '2026-01-02T03:04:09Z' }),
    user([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'failed' }], { timestamp: '2026-01-02T03:04:20Z' })
  ].join('\n') + '\n');
  const r = G.buildReplay(file);
  assert.equal(r.frames.length, 3);
  assert.equal(r.frames[0].state.core, 'Ship it');
  assert.equal(r.frames[0].t, Date.parse('2026-01-02T03:04:05Z'));
  assert.equal(ring(r.frames[1].state, 'Actions').length, 1);
  assert.ok(r.frames[2].pulses.some(p => p.error));
  assert.equal(ring(r.frames[2].state, 'Actions')[0].error, true);
  fs.rmSync(dir, { recursive: true });
});

test('export: home folders are replaced and the page carries the recording safely', () => {
  const data = { id: 's', project: 'p', frames: [{ t: 0, state: { core: 'see ' + os.homedir() + '/secret and /Users/alice/x and /home/bob/y </script>' }, pulses: [] }] };
  const json = G.redact(JSON.stringify(data));
  assert.ok(!json.includes(os.homedir()) && !json.includes('alice') && !json.includes('bob'));
  assert.ok(json.includes('~/secret') && json.includes('~/x') && json.includes('~/y'));
  const html = G.exportPage(data);
  assert.ok(html.includes('window.__REPLAY__ = {'));
  assert.equal(html.split('</script>').length, 3);   // the recording and the page script, nothing broken out early
});

test('prompts: a compaction summary is not the task; a slash command is shown by name', () => {
  const S = session([user('Fix the header'), user('This session is being continued from a previous conversation that ran out of context. Summary: ...')]);
  assert.equal(G.snapshot(S).core, 'Fix the header');
  G.feedText(S, user('also this', { isCompactSummary: true }), true);
  assert.equal(G.snapshot(S).core, 'Fix the header');
  G.feedText(S, user('<command-message>review is running</command-message>\n<command-name>/review</command-name>\n<command-args>the open PR</command-args>'), true);
  assert.equal(G.snapshot(S).core, '/review the open PR');
  G.feedText(S, user('<command-name>/clear</command-name><command-args></command-args>'), true);
  assert.equal(G.snapshot(S).core, '/review the open PR');
});

test('subagent and empty transcripts are told apart from sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-galaxy-'));
  const write = (name, lines) => { const f = path.join(dir, name); fs.writeFileSync(f, lines.join('\n') + '\n'); return [f, fs.statSync(f).size]; };
  assert.equal(G.kindOf(...write('a.jsonl', [user('Do the thing'), asst([{ type: 'text', text: 'ok' }])])), 'session');
  assert.equal(G.kindOf(...write('b.jsonl', [user('search for x', { isSidechain: true }), asst([{ type: 'text', text: 'found' }], {}, { isSidechain: true })])), 'subagent');
  assert.equal(G.kindOf(...write('agent-123.jsonl', [user('search for y'), asst([{ type: 'text', text: 'found' }])])), 'subagent');
  assert.equal(G.kindOf(...write('d.jsonl', [user('<local-command-stdout>hi</local-command-stdout>'), asst([{ type: 'text', text: 'ok' }])])), 'unprompted');
  assert.equal(G.kindOf(...write('c.jsonl', [line({ type: 'summary', summary: 'x' }), line({ type: 'file-history-snapshot' })])), 'empty');
  fs.rmSync(dir, { recursive: true });
});

test('prompts wrapped in tags are still read; a title stands in when there is no prompt', () => {
  assert.equal(G.promptText('<ide_opened_file>The user opened a.ts</ide_opened_file> fix the header'), 'fix the header');
  assert.equal(G.promptText('<task>Check the positions</task>\n<rules>be brief</rules>'), 'Check the positions be brief');
  assert.equal(G.promptText('<local-command-stdout>ok</local-command-stdout>'), '');
  assert.equal(G.promptText('[Request interrupted by user]'), '');
  const S = session([line({ type: 'summary', summary: 'Daily portfolio check' }), asst([{ type: 'text', text: 'Done.' }])]);
  assert.equal(G.snapshot(S).core, 'Daily portfolio check');
  G.feedText(S, user('now sell'), true);
  assert.equal(G.snapshot(S).core, 'now sell');
});
