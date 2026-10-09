// Keeps this session's picture: its agents, what each is doing, its shells, tasks and messages.
// Pure bookkeeping, fed by the hooks in register.tsx; no `$` here.

import type { Activity, Base, Effort, Letter, Shell, Unit, UnitStatus, World } from './model'
import type { TrackerState } from '../types'

export type { TrackerState }

const MAX_LETTERS = 20
const MAX_SHELLS = 6
const MAX_UNITS = 16
const BACKGROUND_TTL_MS = 30 * 60 * 1000

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

type TaskRow = { subject: string; status: string; agent: string }

// Relative price weights, used only to split the session's exact cost between its agents.
function weight(model: string) {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 5
  if (m.includes('haiku')) return 1
  return 3
}

export function effortOf(e: unknown): Effort | undefined {
  return e === 'low' || e === 'medium' || e === 'high' || e === 'xhigh' || e === 'max' ? e : undefined
}

export function shorten(text: string, n = 60) {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

export class Tracker {
  readonly base: Base
  letters: Letter[] = []
  private units = new Map<string, Unit>()
  private cost = new Map<string, number>() // weighted tokens per unit, for the cost split
  private tasks = new Map<string, TaskRow>()
  private todoAgents = new Set<string>()
  private parents = new Map<string, string>()
  private seq = 0
  /** The session's whole cost, as last read. */
  usd = 0
  /** The cost when tracking began: what is shown is the cost since. */
  usdBase: number | undefined
  dirty = true

  constructor(readonly sid: string, name: string, now: number, model: string) {
    this.base = { id: sid, name, tokens: 0, usd: 0, updatedAt: now, units: [] }
    this.units.set(this.key(), {
      id: this.key(), name: 'main', model, status: 'idle', isHero: true, tokens: 0, usd: 0, done: 0, total: 0,
    })
  }

  save(): TrackerState {
    return {
      sid: this.sid,
      base: this.base,
      letters: this.letters,
      units: [...this.units.values()],
      cost: [...this.cost],
      tasks: [...this.tasks],
      todoAgents: [...this.todoAgents],
      parents: [...this.parents],
      seq: this.seq,
      usd: this.usd,
      usdBase: this.usdBase,
    }
  }

  /** Records the session's whole cost; the first reading is the baseline. */
  setCost(total: number) {
    this.usdBase ??= total
    if (total !== this.usd) {
      this.usd = total
      this.dirty = true
    }
  }

  get tracked() {
    return Math.max(0, this.usd - (this.usdBase ?? this.usd))
  }

  static restore(s: TrackerState): Tracker {
    const t = new Tracker(s.sid, s.base.name, s.base.updatedAt, '')
    t.units = new Map(s.units.map(u => [u.id, u]))
    t.cost = new Map(s.cost)
    t.tasks = new Map(s.tasks)
    t.todoAgents = new Set(s.todoAgents)
    t.parents = new Map(s.parents)
    t.letters = s.letters
    t.seq = s.seq
    t.usd = s.usd
    t.usdBase = s.usdBase
    t.dirty = true
    return t
  }

  /** The unit id for an agent of this session; the main loop when absent. */
  key(agentId?: string) {
    return `${this.sid}:${agentId ?? 'main'}`
  }

  unit(agentId?: string): Unit {
    const id = this.key(agentId)
    let u = this.units.get(id)
    if (!u) {
      u = { id, name: agentId ? agentId.slice(0, 8) : 'main', model: '', status: 'running', tokens: 0, usd: 0, done: 0, total: 0 }
      this.units.set(id, u)
    }
    return u
  }

  private touch() {
    this.dirty = true
  }

  // ── Lifecycle.
  spawned(agentId: string, info: { name: string; model: string; parent?: string; at: number }) {
    const u = this.unit(agentId)
    u.name = info.name
    if (info.model) u.model = info.model
    u.status = 'running'
    u.activity = { kind: 'thinking', since: info.at }
    this.parents.set(agentId, info.parent ?? '')
    this.letter(this.key(info.parent), u.id, `orders: ${info.name}`, info.at)
    this.touch()
  }

  named(agentId: string, name: string) {
    const u = this.unit(agentId)
    if (u.name !== name) {
      u.name = name
      this.touch()
    }
  }

  status(agentId: string | undefined, status: UnitStatus) {
    const u = this.unit(agentId)
    if (u.status !== status) {
      u.status = status
      if (status === 'done' || status === 'failed' || status === 'idle') u.activity = undefined
      this.touch()
    }
  }

  turnStarted(agentId: string | undefined, at: number) {
    const u = this.unit(agentId)
    u.status = 'running'
    u.activity = { kind: 'thinking', since: at }
    this.touch()
  }

  turnEnded(agentId: string | undefined, reason: string, at: number) {
    const u = this.unit(agentId)
    u.activity = undefined
    for (const sh of u.shells ?? []) {
      if (sh.state === 'running') {
        sh.state = 'failed'
        sh.endedAt = at
      }
    }
    if (!agentId) u.status = 'idle'
    else {
      u.status = reason === 'error' || reason === 'refusal' ? 'failed' : 'done'
      const parent = this.parents.get(agentId)
      this.letter(u.id, this.key(parent || undefined), reason === 'answer' ? 'report' : reason, at)
    }
    this.touch()
  }

  // ── Model steps.
  stepStarted(agentId: string | undefined, model: string, effort: unknown, at: number) {
    const u = this.unit(agentId)
    u.model = model || u.model
    u.effort = effortOf(effort) ?? u.effort
    // A model step means the agent is not blocked on you or on another agent any more.
    if (u.activity?.kind !== 'thinking') u.activity = { kind: 'thinking', since: at }
    u.status = 'running'
    this.touch()
  }

  stepEnded(agentId: string | undefined, usage: Usage | null, model?: string) {
    if (!usage) return
    const u = this.unit(agentId)
    // Every token the call processed; cache reads are cheap, so they weigh a tenth in the cost split.
    u.tokens += usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    const w = weight(model || u.model)
    const billed = usage.input_tokens + usage.cache_creation_input_tokens * 1.25 + usage.output_tokens * 5 + usage.cache_read_input_tokens * 0.1
    this.cost.set(u.id, (this.cost.get(u.id) ?? 0) + w * billed)
    this.touch()
  }

  // ── Tools.
  toolStarted(agentId: string | undefined, tool: string, input: Record<string, unknown>, id: string, at: number) {
    const u = this.unit(agentId)
    if (tool === 'Bash') {
      const command = String(input.command ?? '')
      u.activity = { kind: 'shell', detail: shorten(command, 80), since: at }
      this.shell(u, { id, command: shorten(command, 200), state: 'running', startedAt: at })
    } else if (tool === 'AskUserQuestion') {
      const q = Array.isArray(input.questions) ? (input.questions[0] as { question?: string })?.question : undefined
      u.activity = { kind: 'needs-you', detail: `question: ${shorten(q ?? 'a question', 70)}`, since: at }
    } else if (tool === 'Agent' && input.run_in_background === false) {
      u.activity = { kind: 'waiting-agent', detail: shorten(String(input.description ?? input.name ?? 'an agent'), 40), since: at }
    } else if (tool === 'SendMessage') {
      const to = String(input.to ?? '')
      this.letter(u.id, this.address(to), shorten(String(input.summary ?? input.message ?? ''), 80), at)
      u.activity = { kind: 'tool', detail: `message to ${shorten(to, 30)}`, since: at }
    } else {
      u.activity = { kind: 'tool', detail: tool, since: at }
    }
    this.touch()
  }

  toolEnded(agentId: string | undefined, tool: string, input: Record<string, unknown>, id: string, result: unknown, isError: boolean, at: number) {
    const u = this.unit(agentId)
    if (tool === 'Bash') {
      const sh = u.shells?.find(s => s.id === id)
      if (sh) {
        const r = (result ?? {}) as { backgroundTaskId?: string; interrupted?: boolean }
        if (input.run_in_background === true || r.backgroundTaskId) sh.state = 'background'
        else {
          sh.state = isError || r.interrupted ? 'failed' : 'ok'
          sh.endedAt = at
        }
      }
    } else if (tool === 'TodoWrite') {
      const r = (result ?? {}) as { newTodos?: { content: string; status: string; activeForm?: string }[] }
      const todos = r.newTodos ?? (input.todos as { content: string; status: string; activeForm?: string }[] | undefined) ?? []
      u.total = todos.length
      u.done = todos.filter(t => t.status === 'completed').length
      const now = todos.find(t => t.status === 'in_progress')
      u.current = now ? shorten(now.activeForm || now.content, 60) : undefined
      this.todoAgents.add(u.id)
    } else if (tool === 'TaskCreate') {
      const r = (result ?? {}) as { task?: { id: string; subject: string } }
      if (r.task) this.tasks.set(r.task.id, { subject: r.task.subject, status: 'pending', agent: u.id })
      this.recount()
    } else if (tool === 'TaskUpdate') {
      const t = this.tasks.get(String(input.taskId ?? ''))
      if (t) {
        if (typeof input.status === 'string') t.status = input.status
        if (typeof input.subject === 'string') t.subject = input.subject
        if (typeof input.owner === 'string') t.agent = this.address(input.owner)
      }
      this.recount()
    } else if (tool === 'TaskList') {
      const r = (result ?? {}) as { tasks?: { id: string; subject: string; status: string; owner?: string }[] }
      for (const t of r.tasks ?? []) {
        const known = this.tasks.get(t.id)
        this.tasks.set(t.id, { subject: t.subject, status: t.status, agent: t.owner ? this.address(t.owner) : (known?.agent ?? u.id) })
      }
      this.recount()
    }
    u.activity = undefined
    this.touch()
  }

  needsYou(agentId: string | undefined, detail: string, at: number) {
    const u = this.unit(agentId)
    u.activity = { kind: 'needs-you', detail: shorten(detail, 90), since: at }
    this.touch()
  }

  answered(agentId: string | undefined) {
    const u = this.unit(agentId)
    if (u.activity?.kind === 'needs-you') {
      u.activity = undefined
      this.touch()
    }
  }

  received(from: string, text: string, at: number) {
    this.letter(from, this.key(), shorten(text, 80), at)
    this.touch()
  }

  sent(agentId: string | undefined, to: string, text: string, at: number) {
    this.letter(this.key(agentId), this.address(to), shorten(text, 80), at)
    this.touch()
  }

  private address(to: string): string {
    if (to === 'main' || to === '') return this.key()
    for (const u of this.units.values()) if (u.name === to || u.id.endsWith(`:${to}`)) return u.id
    return to
  }

  private letter(from: string, to: string, text: string, at: number) {
    this.letters.push({ id: `${this.sid}:${++this.seq}`, from, to, text, at })
    if (this.letters.length > MAX_LETTERS) this.letters.splice(0, this.letters.length - MAX_LETTERS)
  }

  private shell(u: Unit, sh: Shell) {
    const list = [sh, ...(u.shells ?? [])]
    const live = list.filter(s => s.state === 'running' || s.state === 'background')
    const done = list.filter(s => s.state === 'ok' || s.state === 'failed').slice(0, Math.max(1, MAX_SHELLS - live.length))
    u.shells = [...live, ...done]
  }

  private recount() {
    const counts = new Map<string, { done: number; total: number; current?: string }>()
    for (const t of this.tasks.values()) {
      if (t.status === 'deleted') continue
      const c = counts.get(t.agent) ?? { done: 0, total: 0 }
      c.total++
      if (t.status === 'completed') c.done++
      if (t.status === 'in_progress') c.current = shorten(t.subject, 60)
      counts.set(t.agent, c)
    }
    for (const u of this.units.values()) {
      if (this.todoAgents.has(u.id)) continue // TodoWrite is that agent's own list
      const c = counts.get(u.id)
      u.done = c?.done ?? 0
      u.total = c?.total ?? 0
      u.current = c?.current
    }
  }

  /** This session as a Base, its cost split between agents by weighted tokens. */
  snapshot(now: number): Base {
    let units = [...this.units.values()]
    if (units.length > MAX_UNITS) {
      const finished = units.filter(u => !u.isHero && (u.status === 'done' || u.status === 'failed'))
      const drop = new Set(finished.slice(0, units.length - MAX_UNITS).map(u => u.id))
      units = units.filter(u => !drop.has(u.id))
    }
    // Before any tokens are counted, the main agent carries the whole cost.
    const weights = units.map(u => this.cost.get(u.id) ?? 0)
    const sum = weights.reduce((a, b) => a + b, 0)
    const spent = this.tracked
    units.forEach((u, i) => (u.usd = sum ? (spent * weights[i]!) / sum : u.isHero ? spent : 0))
    // A background shell is never reported finished; let it go after a while.
    for (const u of units) {
      for (const sh of u.shells ?? []) {
        if (sh.state === 'background' && now - sh.startedAt > BACKGROUND_TTL_MS) {
          sh.state = 'ok'
          sh.endedAt = now
        }
      }
    }
    this.base.units = units.map(u => ({ ...u, shells: u.shells?.map(s => ({ ...s })), activity: u.activity && { ...u.activity } as Activity }))
    this.base.tokens = units.reduce((n, u) => n + u.tokens, 0)
    this.base.usd = spent
    this.base.usdTotal = this.usd
    this.base.updatedAt = now
    return { ...this.base }
  }
}

/** Merges this session with the others' snapshots into one world. */
export function merge(own: Base, ownLetters: Letter[], others: { base: Base; letters: Letter[] }[], now: number): World {
  const bases = [own, ...others.map(o => o.base)]
  const seen = new Set<string>()
  const letters: Letter[] = []
  for (const l of [...ownLetters, ...others.flatMap(o => o.letters)].sort((a, b) => a.at - b.at)) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    letters.push(l)
  }
  return { bases, letters: letters.slice(-MAX_LETTERS * 2), now }
}
