// A sample world for `/rts demo` and for previews: two sessions at war.
import type { World } from './model'

export function demoWorld(now: number): World {
  return {
    now,
    bases: [
      {
        id: 'demo-mods', name: 'Mods', tokens: 148_000, usd: 3.1, updatedAt: now,
        units: [
          { id: 'main-mods', name: 'commander', model: 'claude-opus-5-5', effort: 'high', status: 'running', isHero: true, tokens: 52_000, usd: 1.22, done: 4, total: 7, current: 'Wire the data layer', activity: { kind: 'shell', detail: 'npm test', since: now - 12_000 }, shells: [{ id: 's1', command: 'npm test -- --watch=false', state: 'running', startedAt: now - 12_000 }] },
          { id: 'a1', name: 'planner', model: 'claude-opus-5-5', effort: 'high', status: 'running', tokens: 61_000, usd: 1.42, done: 7, total: 9, current: 'Draft the scene', activity: { kind: 'tool', detail: 'Edit', since: now - 2_000 }, shells: [{ id: 's2', command: 'npm run dev', state: 'background', startedAt: now - 600_000 }, { id: 's3', command: 'git status', state: 'ok', startedAt: now - 90_000, endedAt: now - 89_000 }] },
          { id: 'a2', name: 'explorer', model: 'claude-sonnet-5-5', effort: 'medium', status: 'running', tokens: 44_000, usd: 0.31, done: 2, total: 8, current: 'Map the API', activity: { kind: 'thinking', since: now - 4_000 } },
          { id: 'a3', name: 'linter', model: 'claude-haiku-5-5', effort: 'low', status: 'done', tokens: 9_000, usd: 0.02, done: 5, total: 5 },
          { id: 'a4', name: 'scout', model: 'claude-haiku-5-5', effort: 'low', status: 'running', tokens: 3_000, usd: 0.01, done: 0, total: 0, activity: { kind: 'shell', detail: 'rg -n TODO', since: now - 1_000 }, shells: [{ id: 's4', command: 'rg -n TODO src', state: 'running', startedAt: now - 1_000 }] },
        ],
      },
      {
        id: 'demo-api', name: 'api', tokens: 264_000, usd: 3.74, updatedAt: now,
        units: [
          { id: 'main-api', name: 'commander', model: 'claude-sonnet-5-5', effort: 'medium', status: 'waiting', isHero: true, tokens: 120_000, usd: 1.2, done: 1, total: 4, activity: { kind: 'waiting-agent', detail: 'fixer', since: now - 30_000 } },
          { id: 'b1', name: 'fixer', model: 'claude-opus-5-5', effort: 'max', status: 'waiting', tokens: 97_000, usd: 2.2, done: 3, total: 7, current: 'Fix flaky tests', activity: { kind: 'needs-you', detail: 'permission: Bash git push origin fix/flaky', since: now - 45_000 }, shells: [{ id: 's5', command: 'npm test flaky.spec.ts', state: 'failed', startedAt: now - 70_000, endedAt: now - 50_000 }] },
          { id: 'b2', name: 'reviewer', model: 'claude-sonnet-5-5', effort: 'medium', status: 'idle', tokens: 2_000, usd: 0.01, done: 0, total: 0 },
        ],
      },
    ],
    letters: [
      { id: 'l1', from: 'a2', to: 'b1', text: 'schema changed, re-run migrations', at: now - 1000 },
      { id: 'l2', from: 'b1', to: 'main-mods', text: 'blocked on review', at: now - 3000 },
    ],
  }
}
