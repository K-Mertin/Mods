import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { demoWorld } from './demo'
import { totals, type Unit, type World } from './model'
import { toCells } from './raster'
import { layout, type Scene } from './scene'
import { toSvg } from './svg'
import { Tracker, merge, shorten } from './tracker'
import type { Base, Letter, UnitStatus } from './model'

const PANE = 'rts'
// Desktop: CSS pixels per layout cell, and how much each map pixel is enlarged.
const PX_PER_CELL = 7.8
const SCALE = 3
const MIN_MAP_W = 300
const MAX_MAP_W = 640
const EMPTY: World = { bases: [], letters: [], now: 0 }
const TICK_MS = 1500
const HEARTBEAT_MS = 5000
const STALE_MS = 20000

const world = atom({ plugin: 'rts', key: 'world' } as const, EMPTY)
const selected = atom({ plugin: 'rts', key: 'selected' } as const, null)
const isDemo = atom({ plugin: 'rts', key: 'isDemo' } as const, false)

function kfmt(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function modelName(model: string) {
  const m = model.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)?[-_.]?(\d+)?/i)
  if (!m) return model
  return [m[1]![0]!.toUpperCase() + m[1]!.slice(1), m[2] && m[3] ? `${m[2]}.${m[3]}` : (m[2] ?? '')].join(' ').trim()
}

const STATUS = { running: '▶ running', waiting: '‖ waiting', idle: '· idle', done: '✓ done', failed: '✗ failed' } as const

const SHELL_MARK = { running: '▶', background: '◌', ok: '✓', failed: '✗' } as const
const SHELL_COLOR = { running: '#A7F070', background: '#EF7D57', ok: '#94B0C2', failed: '#E24B4A' } as const

function rank(state: keyof typeof SHELL_MARK) {
  return state === 'running' ? 0 : state === 'background' ? 1 : 2
}

function since(now: number, at: number) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

function doing(u: Unit, now: number) {
  const a = u.activity
  if (!a) return ''
  const t = since(now, a.since)
  switch (a.kind) {
    case 'needs-you': return `  ! needs you: ${a.detail ?? 'a response'} (${t})`
    case 'waiting-agent': return `  ⧗ waiting on ${a.detail ?? 'another agent'} (${t})`
    case 'thinking': return `  … thinking (${t})`
    case 'shell': return `  $ ${a.detail ?? 'shell'} (${t})`
    case 'tool': return `  ⚙ ${a.detail ?? 'tool'} (${t})`
  }
}

function detail(u: Unit, now: number) {
  const left = Math.max(0, u.total - u.done)
  const work = u.total ? `${u.done}/${u.total} tasks done · ${left} left` : 'no task list'
  const eff = u.effort ? ` · ${u.effort}` : ''
  return `${u.isHero ? '♛ main · ' : ''}${u.name}  ${modelName(u.model)}${eff}  ${STATUS[u.status]}  ${kfmt(u.tokens)} tokens  $${u.usd.toFixed(2)}  ${work}${u.current ? `  ▸ ${u.current}` : ''}${doing(u, now)}`
}

// ── Live tracking: this session's tracker, and the shared folder every session reports to.
let tracker: Tracker | undefined
let dir = ''
let lastWrite = 0
let lastOthers = ''
let others: { base: Base; letters: Letter[] }[] = []

const LIST_STATUS: Record<string, UnitStatus> = {
  pending: 'running', running: 'running', waiting: 'waiting', idle: 'idle', completed: 'done', failed: 'failed', killed: 'failed',
}

async function tick($: EngineInterface) {
  const t = tracker
  if (!t) return
  const now = await $.clock.now()
  try {
    const usage = await $.session.usage()
    const usd = usage.cost?.usd ?? 0
    if (usd !== t.usd) {
      t.usd = usd
      t.dirty = true
    }
  } catch {}
  try {
    for (const a of await $.agent.list()) {
      t.named(a.id, shorten(a.name ?? a.description ?? a.type, 18))
      const status = LIST_STATUS[a.status]
      if (status && status !== 'running') t.status(a.id, status)
    }
  } catch {}
  const own = t.snapshot(now)
  if (dir && (t.dirty || now - lastWrite > HEARTBEAT_MS)) {
    try {
      await $.fs.write(`${dir}/${t.sid}.json`, JSON.stringify({ base: own, letters: t.letters, ended: false }))
      lastWrite = now
    } catch {}
  }
  let othersChanged = false
  if (dir) {
    try {
      const found: { base: Base; letters: Letter[] }[] = []
      for (const f of await $.fs.list(dir)) {
        if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === `${t.sid}.json`) continue
        try {
          const snap = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as { base?: Base; letters?: Letter[]; ended?: boolean }
          if (!snap.base || snap.ended || now - snap.base.updatedAt > STALE_MS) continue
          found.push({ base: snap.base, letters: snap.letters ?? [] })
        } catch {}
      }
      const sig = JSON.stringify(found.map(o => [o.base, o.letters.length]))
      if (sig !== lastOthers) {
        lastOthers = sig
        others = found
        othersChanged = true
      }
    } catch {}
  }
  if (t.dirty || othersChanged) {
    t.dirty = false
    await update($, world, () => merge(own, t.letters, others, now))
  }
}

// The desktop map is rebuilt only when what it draws changes (or its labels are stale),
// so its animations keep running between token updates.
const LABEL_REFRESH_MS = 15000
let lastSvg = ''
let lastSig = ''
let lastSvgAt = 0

function signature(w: World) {
  const recent = w.letters.filter(l => w.now - l.at < 12000).map(l => l.id)
  return JSON.stringify([
    w.bases.map(b => [b.id, b.name, b.units.map(u => [u.id, u.name, u.model, u.effort, u.status, u.done, u.total, u.activity?.kind, u.activity?.detail?.slice(0, 8), (u.shells ?? []).filter(x => x.state === 'running' || x.state === 'background').map(x => x.id)])]),
    recent,
  ])
}

async function shown($: EngineInterface): Promise<World> {
  if (await read($, isDemo)) return demoWorld(await $.clock.now())
  return read($, world)
}

export const register: Register = on => {
  let timer: Timer | undefined
  let scene: Scene | undefined
  let started = 0
  let terminalWidth = 0

  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    const [sid, root, model, home] = await Promise.all([$.session.id(), $.session.root(), $.session.model(), $.env.get('HOME')])
    tracker = new Tracker(sid, root.split('/').filter(Boolean).pop() ?? root, await $.clock.now(), model)
    dir = home ? `${home}/.claude/rts` : ''
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => void tick($))
    await $.command.register({
      name: 'rts',
      description: 'Show sessions, agents, tokens, cost and task progress as a live map',
      argumentHint: '[demo|live]',
    })
    return next(e)
  })

  on('command.run', { command: 'rts' }, async ($, e) => {
    const arg = e.args.trim()
    await update($, isDemo, () => arg === 'demo')
    await $.ui.open({ id: PANE, title: 'Sessions & agents', rows: 40 })
    return { text: arg === 'demo' ? 'Map opened with sample data.' : 'Map opened.' }
  })

  // ── What the agents do.
  on('turn.step', async function* ($, e, next) {
    tracker?.stepStarted(e.agentId, e.model, e.effort, Date.now())
    const r = yield* next(e)
    tracker?.stepEnded(e.agentId, r.usage, r.usage?.model)
    return r
  })

  on('turn.complete', ($, e, next) => {
    tracker?.turnEnded(e.agentId, e.reason, Date.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      tracker?.spawned(r.agentId, { name: shorten(e.description || e.subagentType, 18), model: r.model, parent: e.parentAgentId, at: Date.now() })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? `${Date.now()}`
    const tool = String(e.tool)
    tracker?.toolStarted(e.agentId, tool, input, id, Date.now())
    const r = await next(e)
    const result = 'result' in r ? r.result : undefined
    tracker?.toolEnded(e.agentId, tool, input, id, result, r.isError === true || r.deny !== undefined, Date.now())
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', ($, e, next) => {
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const what = typeof input.command === 'string' ? input.command : typeof input.file_path === 'string' ? input.file_path : ''
    tracker?.needsYou(e.agent_id, `permission: ${e.tool_name}${what ? ` ${what}` : ''}`, Date.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    tracker?.sent(e.agentId, e.to, e.text, Date.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    const o = e.origin
    const from = 'teammate' in o ? o.teammate : o.kind
    tracker?.received(from, e.text, Date.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    if (tracker && dir) {
      try {
        await $.fs.write(`${dir}/${tracker.sid}.json`, JSON.stringify({ base: tracker.snapshot(Date.now()), letters: [], ended: true }))
      } catch {}
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const w = await shown($)
    const sel = await read($, selected)
    const t = totals(w)
    const units = w.bases.flatMap(b => b.units)
    const running = units.filter(u => u.status === 'running').length
    const waiting = units.filter(u => u.status === 'waiting').length
    const needsCount = units.filter(u => u.activity?.kind === 'needs-you').length
    const tasksLeft = units.reduce((n, u) => n + Math.max(0, u.total - u.done), 0)
    const chosen = units.find(u => u.id === sel)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hud = (
      <Box flexDirection="row" gap={2}>
        <Text color="#FFCD75" bold>{t.sessions} sessions</Text>
        <Text color="#73EFF7">{kfmt(t.tokens)} tokens</Text>
        <Text color="#FFCD75">${t.usd.toFixed(2)}</Text>
        <Text color="#A7F070">{t.units} agents · {running} running · {waiting} waiting</Text>
        {needsCount > 0 && <Text color="#FFCD75" bold>! {needsCount} need you</Text>}
        <Text color="#EF7D57">{t.done}/{t.total} tasks done · {tasksLeft} left</Text>
      </Box>
    )
    const roster = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {units.map(u => (
          <Button
            key={`u-${u.id}`}
            label={`${u.isHero ? '♛' : '•'} ${u.name}`}
            variant={u.id === sel ? 'primary' : 'secondary'}
            onPress={() => update($, selected, s => (s === u.id ? null : u.id))}
          />
        ))}
      </Box>
    )
    const letters = w.letters.slice(-3).reverse()
    const names = new Map<string, string>()
    for (const b of w.bases) {
      names.set(b.id, b.name)
      for (const u of b.units) names.set(u.id, `${u.name}@${b.name}`)
    }
    const comms = (
      <Box flexDirection="column">
        {letters.map(l => (
          <Text key={l.id} color="#94B0C2">
            ✉ {names.get(l.from) ?? l.from} → {names.get(l.to) ?? l.to}  “{l.text.slice(0, 80)}”
          </Text>
        ))}
      </Box>
    )
    const owner = new Map<string, string>()
    for (const b of w.bases) for (const u of b.units) owner.set(u.id, w.bases.length > 1 ? `${u.name}@${b.name}` : u.name)
    const needy = units.filter(u => u.activity?.kind === 'needs-you')
    const needs = needy.length ? (
      <Box flexDirection="column">
        {needy.map(u => (
          <Text key={`n-${u.id}`} color="#FFCD75" bold>
            ! {owner.get(u.id)} needs you: {u.activity?.detail ?? 'a response'} · {since(w.now, u.activity!.since)}
          </Text>
        ))}
      </Box>
    ) : null
    const shellRows = units.flatMap(u => (u.shells ?? []).map(sh => ({ u, sh })))
    shellRows.sort((p, q) => rank(p.sh.state) - rank(q.sh.state) || q.sh.startedAt - p.sh.startedAt)
    const shellList = shellRows.length ? (
      <Box flexDirection="column">
        <Text dimColor>Shells</Text>
        {shellRows.slice(0, 6).map(({ u, sh }) => (
          <Text key={`sh-${sh.id}`} color={SHELL_COLOR[sh.state]}>
            {SHELL_MARK[sh.state]} $ {sh.command.slice(0, 70)}  · {owner.get(u.id)} · {sh.endedAt ? `took ${since(sh.endedAt, sh.startedAt)}` : since(w.now, sh.startedAt)}
          </Text>
        ))}
      </Box>
    ) : null
    const info = <Text color="#41A6F6">{chosen ? detail(chosen, w.now) : 'Select an agent below for details.'}</Text>

    if (w.bases.length === 0) {
      return (
        <Box flexDirection="column">
          {hud}
          <Text dimColor>No sessions reporting yet. Run `/rts demo` to see sample data.</Text>
        </Box>
      )
    }

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      // Size the frame ourselves: the pane's width in CSS pixels, the map laid out to fill it.
      const cols = e.props.bodyColumns || e.viewport?.columns || 140
      const px = Math.round(cols * PX_PER_CELL)
      const mapW = Math.max(MIN_MAP_W, Math.min(MAX_MAP_W, Math.round(px / SCALE)))
      const s = layout(w, mapW)
      const k = px / mapW
      const sig = `${mapW}|${signature(w)}`
      const now = Date.now()
      if (sig !== lastSig || now - lastSvgAt > LABEL_REFRESH_MS || !lastSvg) {
        lastSvg = toSvg(s, { minimap: true })
        lastSig = sig
        lastSvgAt = now
      }
      return (
        <Box flexDirection="column" gap={1}>
          {hud}
          {needs}
          <Svg
            source={lastSvg}
            alt={`Map: ${t.sessions} sessions, ${t.units} agents, ${tasksLeft} tasks left`}
            width={px}
            height={Math.round(s.h * k)}
            isInteractive
          />
          {info}
          {roster}
          {shellList}
          {comms}
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const cols = Math.max(80, Math.min(220, (e.viewport?.columns ?? 120) - 2))
      if (cols !== terminalWidth || !scene) terminalWidth = cols
      scene = layout(w, terminalWidth)
      started ||= await $.clock.now()
      const first = toCells(scene, 0)
      timer ??= $.clock.every(120, async () => {
        if (!scene) return
        const f = toCells(scene, (await $.clock.now()) - started)
        void $.ui.blit({ requestId: PANE, key: 'map', cells: f.cells })
      })
      return (
        <Box flexDirection="column">
          {hud}
          {needs}
          <Raster key="map" columns={first.columns} rows={first.rows} cells={first.cells} />
          {info}
          {roster}
          {shellList}
          {comms}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {hud}
        {needs}
        {info}
        {shellList}
        {comms}
      </Box>
    )
  })

  on('ui.close', { id: PANE }, ($, e, next) => {
    timer?.cancel()
    timer = undefined
    scene = undefined
    return next(e)
  }).catch(($, e, next) => next(e))
}
