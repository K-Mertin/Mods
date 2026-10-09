import { expect, test } from 'claude-code/testing'

import { Tracker, merge } from '../hooks/tracker'

const usage = (n: number) => ({ input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

function find(t: Tracker, agentId?: string) {
  return t.snapshot(0).units.find(u => u.id === t.key(agentId))!
}

test('a spawned agent appears with its name and model, and orders fly to it', () => {
  const t = new Tracker('s1', 'Mods', 0, 'claude-opus-5-5')
  t.spawned('a1', { name: 'explorer', model: 'claude-sonnet-5-5', at: 1 })
  const u = find(t, 'a1')
  expect(u.name).toBe('explorer')
  expect(u.model).toBe('claude-sonnet-5-5')
  expect(u.status).toBe('running')
  expect(t.letters.at(-1)).toMatchObject({ from: 's1:main', to: 's1:a1' })
})

test('a model step records the model, effort and tokens of its agent', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.stepStarted('a1', 'claude-haiku-5-5', 'low', 1)
  expect(find(t, 'a1').activity?.kind).toBe('thinking')
  t.stepEnded('a1', usage(1200))
  const u = find(t, 'a1')
  expect(u.effort).toBe('low')
  expect(u.tokens).toBe(1200)
})

test('a shell runs, then ends ok or failed; a background shell stays', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.toolStarted(undefined, 'Bash', { command: 'npm test' }, 'b1', 10)
  expect(find(t).activity).toMatchObject({ kind: 'shell', detail: 'npm test' })
  expect(find(t).shells?.[0]).toMatchObject({ command: 'npm test', state: 'running' })
  t.toolEnded(undefined, 'Bash', { command: 'npm test' }, 'b1', {}, true, 20)
  expect(find(t).shells?.[0]).toMatchObject({ state: 'failed', endedAt: 20 })
  expect(find(t).activity).toBeUndefined()

  t.toolStarted(undefined, 'Bash', { command: 'npm run dev', run_in_background: true }, 'b2', 30)
  t.toolEnded(undefined, 'Bash', { command: 'npm run dev', run_in_background: true }, 'b2', { backgroundTaskId: 'x' }, false, 31)
  expect(find(t).shells?.[0]).toMatchObject({ command: 'npm run dev', state: 'background' })
})

test('TodoWrite sets done, total and the item in progress', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  const todos = [
    { content: 'a', status: 'completed', activeForm: 'Doing a' },
    { content: 'b', status: 'in_progress', activeForm: 'Doing b' },
    { content: 'c', status: 'pending', activeForm: 'Doing c' },
  ]
  t.toolStarted('a1', 'TodoWrite', { todos }, 't1', 1)
  t.toolEnded('a1', 'TodoWrite', { todos }, 't1', { newTodos: todos }, false, 2)
  expect(find(t, 'a1')).toMatchObject({ done: 1, total: 3, current: 'Doing b' })
})

test('TaskCreate and TaskUpdate count toward the agent that made the task', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.toolEnded(undefined, 'TaskCreate', { subject: 'one' }, 'c1', { task: { id: '1', subject: 'one' } }, false, 1)
  t.toolEnded(undefined, 'TaskCreate', { subject: 'two' }, 'c2', { task: { id: '2', subject: 'two' } }, false, 2)
  t.toolEnded(undefined, 'TaskUpdate', { taskId: '1', status: 'completed' }, 'u1', { success: true }, false, 3)
  t.toolEnded(undefined, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, 'u2', { success: true }, false, 4)
  expect(find(t)).toMatchObject({ done: 1, total: 2, current: 'two' })
})

test('a permission prompt marks the agent as needing you until the call ends', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.toolStarted('a1', 'Bash', { command: 'git push' }, 'p1', 1)
  t.needsYou('a1', 'permission: Bash git push', 2)
  expect(find(t, 'a1').activity).toMatchObject({ kind: 'needs-you', detail: 'permission: Bash git push' })
  t.toolEnded('a1', 'Bash', { command: 'git push' }, 'p1', {}, false, 3)
  expect(find(t, 'a1').activity).toBeUndefined()
})

test('a question to you is a needs-you state', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.toolStarted(undefined, 'AskUserQuestion', { questions: [{ question: 'Which theme?' }] }, 'q1', 1)
  expect(find(t).activity).toMatchObject({ kind: 'needs-you', detail: 'question: Which theme?' })
})

test('the session cost is split between agents and adds up', () => {
  const t = new Tracker('s1', 'Mods', 0, 'claude-opus-5-5')
  t.stepEnded(undefined, usage(1000), 'claude-opus-5-5')
  t.stepEnded('a1', usage(1000), 'claude-haiku-5-5')
  t.setCost(4)
  t.setCost(10)
  const units = t.snapshot(5).units
  const sum = units.reduce((n, u) => n + u.usd, 0)
  expect(Math.round(sum * 100)).toBe(600)
  expect(units.find(u => u.id === 's1:main')!.usd).toBeGreaterThan(units.find(u => u.id === 's1:a1')!.usd)
})

test('merging sessions keeps each letter once', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.sent(undefined, 'peer', 'hi', 1)
  const other = new Tracker('s2', 'api', 0, '')
  other.sent(undefined, 'main', 'yo', 2)
  const w = merge(t.snapshot(3), t.letters, [{ base: other.snapshot(3), letters: [...other.letters, ...t.letters] }], 3)
  expect(w.bases.map(b => b.name)).toEqual(['Mods', 'api'])
  expect(w.letters.map(l => l.text)).toEqual(['hi', 'yo'])
})

test('a new model step clears needs-you and waiting states', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.needsYou('a1', 'permission: Bash rm -rf dist', 1)
  t.stepStarted('a1', 'claude-sonnet-5-5', 'high', 2)
  expect(find(t, 'a1').activity?.kind).toBe('thinking')
  t.toolStarted(undefined, 'Agent', { description: 'review', run_in_background: false }, 'g1', 3)
  expect(find(t).activity?.kind).toBe('waiting-agent')
  t.stepStarted(undefined, 'claude-opus-5-5', 'high', 4)
  expect(find(t).activity?.kind).toBe('thinking')
})

test('a shell still running when its turn ends is marked failed', () => {
  const t = new Tracker('s1', 'Mods', 0, '')
  t.toolStarted('a1', 'Bash', { command: 'sleep 100' }, 'b1', 1)
  t.turnEnded('a1', 'aborted', 5)
  expect(find(t, 'a1').shells?.[0]).toMatchObject({ state: 'failed', endedAt: 5 })
})

test('before any tokens are counted, the main agent carries the session cost', () => {
  const t = new Tracker('s1', 'Mods', 0, 'claude-opus-5-5')
  t.spawned('a1', { name: 'helper', model: 'claude-haiku-5-5', at: 1 })
  t.setCost(20)
  t.setCost(33)
  const units = t.snapshot(2).units
  expect(units.find(u => u.isHero)!.usd).toBe(13)
  expect(units.find(u => u.id === 's1:a1')!.usd).toBe(0)
})

test('a tracker saved and restored keeps its agents, cost weights and messages', () => {
  const t = new Tracker('s1', 'Mods', 0, 'claude-opus-5-5')
  t.spawned('a1', { name: 'helper', model: 'claude-haiku-5-5', at: 1 })
  t.stepEnded('a1', usage(500), 'claude-haiku-5-5')
  t.setCost(1)
  t.setCost(3)
  const back = Tracker.restore(JSON.parse(JSON.stringify(t.save())))
  const units = back.snapshot(3).units
  expect(units.map(u => u.name).sort()).toEqual(['helper', 'main'])
  expect(units.find(u => u.id === 's1:a1')!.tokens).toBe(500)
  expect(back.letters.length).toBe(1)
  expect(back.snapshot(4).usd).toBe(2)
  back.sent(undefined, 'helper', 'next', 4)
  expect(new Set(back.letters.map(l => l.id)).size).toBe(2)
})

test('the cost shown is what was spent since tracking began; the session total is kept beside it', () => {
  const t = new Tracker('s1', 'Mods', 0, 'claude-opus-5-5')
  t.setCost(14.5)
  t.stepEnded(undefined, { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 2_000 })
  t.setCost(14.9)
  const b = t.snapshot(1)
  expect(Math.round(b.usd * 100)).toBe(40)
  expect(b.usdTotal).toBe(14.9)
  expect(b.tokens).toBe(92_510)
})
