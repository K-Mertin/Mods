// Lays a World out as a map of drawables: terrain, headquarters, camps, knights, letters.
// Both renderers (SVG for the desktop, cells for the terminal) draw the same list.

import {
  C, TEAMS, alert, fire, hourglass, question, shellBackground, shellRunning, thought, flower, goblin, grave, knight, letter, pine, rock, tent, tree, tuft, victoryFlag,
  type Armour, type Rgb, type Sprite,
} from './art'
import type { Base, Unit, World } from './model'

export type Pt = readonly [number, number]

export type Anim = {
  frames?: readonly Sprite[] // cycled every frameMs
  frameMs?: number
  bob?: { amp: number; ms: number; phase?: number }
  path?: { pts: readonly Pt[]; ms: number; delay?: number } // loops
  blink?: { ms: number; phase?: number } // visible the first half of each period
}

export type Drawable =
  | { kind: 'sprite'; sprite: Sprite; x: number; y: number; z: number; anim?: Anim; unit?: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: Rgb; z: number; anim?: Anim }
  | { kind: 'text'; x: number; y: number; text: string; color: Rgb; z: number; size?: number; anchor?: 'start' | 'middle' }
  | { kind: 'bar'; x: number; y: number; w: number; p: number; color: Rgb; z: number }

export type Scene = {
  w: number
  h: number
  items: Drawable[]
  river: { x: number; w: number }
  spots: Record<string, Pt> // unit and base ids → where letters fly to
}

// ── A small canvas for procedural sprites.
class Canvas {
  px: (Rgb | null)[]
  constructor(readonly w: number, readonly h: number) {
    this.px = new Array(w * h).fill(null)
  }
  set(x: number, y: number, c: Rgb | null) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c
  }
  fill(x: number, y: number, w: number, h: number, c: Rgb | null) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
  }
  outline(x: number, y: number, w: number, h: number, c: Rgb) {
    this.fill(x, y, w, 1, c)
    this.fill(x, y + h - 1, w, 1, c)
    this.fill(x, y, 1, h, c)
    this.fill(x + w - 1, y, 1, h, c)
  }
  sprite(): Sprite {
    return { w: this.w, h: this.h, px: this.px }
  }
}

function bricks(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.fill(x, y, w, h, C.stone)
  for (let j = 0; j < h; j++) {
    if (j % 3 === 2) cv.fill(x, y + j, w, 1, C.stoneDark)
    else {
      const off = Math.floor(j / 3) % 2 ? 2 : 5
      for (let i = off; i < w; i += 6) cv.set(x + i, y + j, C.stoneDark)
    }
  }
  cv.fill(x, y, w, 1, C.stoneLight)
}

function battlements(cv: Canvas, x: number, y: number, w: number) {
  for (let i = 0; i < w; i += 4) {
    cv.fill(x + i, y - 3, 2, 3, C.stone)
    cv.set(x + i, y - 3, C.stoneLight)
    cv.outline(x + i - 1, y - 4, 4, 4, C.ink)
    cv.fill(x + i, y - 3, 2, 3, C.stone)
  }
}

// Headquarters: two towers, a keep with a gate, team banners. 52×44.
const hqCache = new Map<Rgb, Sprite>()

export function headquarters(team: readonly [Rgb, Rgb]): Sprite {
  let s = hqCache.get(team[0])
  if (!s) hqCache.set(team[0], (s = makeHeadquarters(team)))
  return s
}

function makeHeadquarters(team: readonly [Rgb, Rgb]): Sprite {
  const cv = new Canvas(52, 44)
  // Towers.
  for (const tx of [1, 37]) {
    bricks(cv, tx, 8, 14, 35)
    cv.outline(tx - 1, 7, 16, 37, C.ink)
    battlements(cv, tx, 8, 14)
    cv.fill(tx + 5, 16, 3, 5, C.ink) // window
    cv.fill(tx + 6, 16, 1, 1, C.yellow)
    cv.fill(tx + 5, 28, 3, 4, C.ink)
  }
  // Keep.
  bricks(cv, 15, 14, 22, 29)
  cv.outline(14, 13, 24, 31, C.ink)
  battlements(cv, 15, 14, 22)
  // Gate.
  cv.fill(21, 30, 10, 13, C.ink)
  cv.fill(22, 31, 8, 12, C.woodDark)
  for (let i = 23; i < 30; i += 2) cv.fill(i, 31, 1, 12, C.wood)
  cv.fill(22, 29, 8, 1, C.ink)
  cv.fill(23, 28, 6, 1, C.ink)
  // Banners on the keep.
  for (const bx of [17, 31]) {
    cv.fill(bx, 17, 4, 9, team[0])
    cv.fill(bx, 25, 1, 1, null)
    cv.fill(bx + 3, 25, 1, 1, null)
    cv.fill(bx + 1, 19, 2, 2, C.yellow)
    cv.outline(bx - 1, 16, 6, 11, C.ink)
  }
  // Ground shadow.
  cv.fill(0, 43, 52, 1, C.grassDark)
  return cv.sprite()
}

const flagCache = new Map<Rgb, Sprite[]>()

function flagFrames(team: readonly [Rgb, Rgb]): Sprite[] {
  let f = flagCache.get(team[0])
  if (!f) flagCache.set(team[0], (f = makeFlags(team)))
  return f
}

function makeFlags(team: readonly [Rgb, Rgb]): Sprite[] {
  const a = new Canvas(9, 12)
  const b = new Canvas(9, 12)
  for (const cv of [a, b]) cv.fill(0, 0, 1, 12, C.ink)
  a.fill(1, 1, 7, 4, team[0])
  a.fill(1, 4, 7, 1, team[1])
  b.fill(1, 1, 6, 4, team[0])
  b.fill(7, 2, 1, 3, team[0])
  b.fill(1, 1, 1, 4, team[1])
  return [a.sprite(), b.sprite()]
}

// ── Deterministic randomness, so the map does not shuffle between redraws.
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function armourOf(model: string): Armour {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'gold'
  if (m.includes('sonnet')) return 'steel'
  if (m.includes('haiku')) return 'leather'
  return 'violet'
}

const EFFORT_PIPS: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

export function pipsOf(effort: Unit['effort']) {
  return effort ? (EFFORT_PIPS[effort] ?? 0) : 0
}

const fallenCache = new Map<Sprite, Sprite>()

function fallen(s: Sprite): Sprite {
  let f = fallenCache.get(s)
  if (!f) fallenCache.set(s, (f = { ...s, px: s.px.map(c => (c === null ? null : C.slate)) }))
  return f
}

const CAMP_W = 58
const CAMP_H = 62
const HQ_W = 52

type Box = { x: number; y: number; w: number; h: number }

function overlaps(a: Box, list: Box[]) {
  return list.some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
}

export function layout(world: World, width: number): Scene {
  const items: Drawable[] = []
  const spots: Record<string, Pt> = {}
  const taken: Box[] = []
  const riverX = Math.round(Math.min(width * 0.36, 120))
  const river = { x: riverX, w: 12 }
  const campArea = { x: riverX + river.w + 14, w: width - (riverX + river.w + 14) - 6 }
  const perRow = Math.max(1, Math.floor(campArea.w / CAMP_W))

  // Bands: one per headquarters, tall enough for its camps.
  const bands = world.bases.map(base => {
    const camps = base.units.filter(u => u.total > 0).length
    const rows = Math.max(1, Math.ceil(camps / perRow))
    return { base, h: Math.max(72, 18 + rows * CAMP_H) }
  })
  const top = 6
  const height = Math.max(110, top + bands.reduce((n, b) => n + b.h, 0) + 8)

  // River: water, shimmer, banks.
  items.push({ kind: 'rect', x: riverX - 1, y: 0, w: river.w + 2, h: height, color: C.dirtDark, z: 1 })
  items.push({ kind: 'rect', x: riverX, y: 0, w: river.w, h: height, color: C.blue, z: 2 })
  const rr = rng(7)
  for (let i = 0; i < height / 7; i++) {
    const y = Math.floor(rr() * height)
    const x = riverX + 2 + Math.floor(rr() * (river.w - 5))
    items.push({
      kind: 'rect', x, y, w: 3, h: 1, color: C.sky, z: 3,
      anim: { path: { pts: [[x, y], [x, y + 10]], ms: 2400 + Math.floor(rr() * 1200), delay: rr() * 2000 } },
    })
  }
  taken.push({ x: riverX - 3, y: 0, w: river.w + 6, h: height })

  let y0 = top
  bands.forEach(({ base, h }, bi) => {
    const team = TEAMS[hash(base.id) % TEAMS.length]!
    const hq = { x: 8, y: y0 + 12 }
    const gate: Pt = [hq.x + 26, hq.y + 43]
    spots[base.id] = [hq.x + 26, hq.y + 20]
    taken.push({ x: hq.x - 4, y: hq.y - 14, w: HQ_W + 8, h: 62 })

    // Road: gate → bridge → camp area.
    const roadY = gate[1] + 2
    items.push({ kind: 'rect', x: gate[0] - 3, y: gate[1] - 1, w: 6, h: 4, color: C.dirt, z: 4 })
    items.push({ kind: 'rect', x: gate[0], y: roadY - 1, w: riverX - gate[0], h: 4, color: C.dirt, z: 4 })
    items.push({ kind: 'rect', x: gate[0], y: roadY + 3, w: riverX - gate[0], h: 1, color: C.dirtDark, z: 4 })
    const lastCamp = Math.min(perRow, Math.max(1, base.units.filter(u => u.total > 0).length))
    items.push({ kind: 'rect', x: riverX + river.w, y: roadY - 1, w: campArea.x - riverX - river.w + (lastCamp - 1) * CAMP_W + 6, h: 4, color: C.dirt, z: 4 })
    items.push({ kind: 'rect', x: riverX + river.w, y: roadY + 3, w: campArea.x - riverX - river.w + (lastCamp - 1) * CAMP_W + 6, h: 1, color: C.dirtDark, z: 4 })
    taken.push({ x: gate[0], y: roadY - 3, w: width - gate[0], h: 8 })
    // Bridge.
    items.push({ kind: 'rect', x: riverX - 2, y: roadY - 3, w: river.w + 4, h: 8, color: C.ink, z: 5 })
    for (let i = 0; i < river.w + 2; i += 2) {
      items.push({ kind: 'rect', x: riverX - 1 + i, y: roadY - 2, w: 1, h: 6, color: C.wood, z: 6 })
      items.push({ kind: 'rect', x: riverX + i, y: roadY - 2, w: 1, h: 6, color: C.leatherMid, z: 6 })
    }

    // Headquarters, flags, name and treasury.
    items.push({ kind: 'sprite', sprite: headquarters(team), x: hq.x, y: hq.y, z: 20 })
    const flags = flagFrames(team)
    items.push({ kind: 'sprite', sprite: flags[0]!, x: hq.x + 7, y: hq.y - 15, z: 21, anim: { frames: flags, frameMs: 400 } })
    items.push({ kind: 'sprite', sprite: flags[0]!, x: hq.x + 43, y: hq.y - 15, z: 21, anim: { frames: flags, frameMs: 400 } })
    if (base.units.some(u => u.activity?.kind === 'needs-you')) {
      items.push({ kind: 'sprite', sprite: alert, x: hq.x + 22, y: hq.y - 28, z: 56, anim: { bob: { amp: 1, ms: 500 } } })
    }
    items.push({ kind: 'text', x: hq.x + 26, y: hq.y - 4, text: base.name, color: C.white, z: 40, anchor: 'middle' })
    items.push({ kind: 'text', x: hq.x + 26, y: hq.y + 52, text: `$${base.usd.toFixed(2)} · ${kfmt(base.tokens)}`, color: C.yellow, z: 40, anchor: 'middle', size: 0.8 })

    // Camps for every unit with work; knights in front of their camp.
    const fighters = base.units.filter(u => u.total > 0)
    const resting = base.units.filter(u => u.total === 0)
    fighters.forEach((u, i) => {
      const cx = campArea.x + (i % perRow) * CAMP_W
      const cy = y0 + 4 + Math.floor(i / perRow) * CAMP_H
      taken.push({ x: cx - 18, y: cy - 4, w: CAMP_W + 4, h: CAMP_H })
      camp(items, spots, u, cx, cy, team, roadY, bi)
    })
    resting.forEach((u, i) => {
      const x = hq.x + HQ_W + 6 + (i % 3) * 18
      const y = hq.y + 4 + Math.floor(i / 3) * 34
      taken.push({ x: x - 2, y: y - 6, w: 20, h: 26 })
      reserve(items, spots, u, x, y, team, roadY, gate, riverX + river.w + 4)
    })
    y0 += h
  })

  // Scenery wherever nothing stands.
  const sr = rng(hash(world.bases.map(b => b.id).join()) || 3)
  const kinds: [Sprite, number][] = [[tree, 6], [pine, 6], [rock, 3], [flower, 5], [tuft, 12]]
  for (const [s, n] of kinds) {
    const count = Math.round((n * width * height) / 40000)
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const box = { x: Math.floor(sr() * (width - s.w)), y: Math.floor(sr() * (height - s.h)), w: s.w, h: s.h }
      if (overlaps(box, taken)) continue
      if (s.h > 6) taken.push(box)
      items.push({ kind: 'sprite', sprite: s, x: box.x, y: box.y, z: 10 + box.y / 1000 })
      i++
    }
  }

  // Letters in flight (the last few seconds).
  const recent = world.letters.filter(l => world.now - l.at < 12000).slice(-6)
  recent.forEach((l, i) => {
    const a = spots[l.from]
    const b = spots[l.to]
    if (!a || !b) return
    const mid: Pt = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 24]
    const pts: Pt[] = []
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      pts.push([
        Math.round((1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0]) - 3,
        Math.round((1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1]) - 2,
      ])
    }
    items.push({ kind: 'sprite', sprite: letter, x: pts[0]![0], y: pts[0]![1], z: 60, anim: { path: { pts, ms: 1800, delay: i * 300 } } })
  })

  items.sort((p, q) => p.z - q.z)
  return { w: width, h: height, items, river, spots }
}

function kfmt(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function label(items: Drawable[], u: Unit, x: number, y: number) {
  items.push({ kind: 'text', x, y, text: u.name, color: u.status === 'failed' ? C.red : C.white, z: 45, anchor: 'middle', size: 0.85 })
}

function pips(items: Drawable[], u: Unit, x: number, y: number) {
  const n = pipsOf(u.effort)
  for (let i = 0; i < n; i++) items.push({ kind: 'rect', x: x + i * 2, y, w: 1, h: 1, color: C.yellow, z: 46 })
}

function crown(items: Drawable[], x: number, y: number) {
  items.push({ kind: 'rect', x, y: y + 1, w: 5, h: 2, color: C.gold, z: 47 })
  for (const i of [0, 2, 4]) items.push({ kind: 'rect', x: x + i, y, w: 1, h: 1, color: C.gold, z: 47 })
}

// Over the head: what the agent waits on. Beside it: its shells.
function overhead(items: Drawable[], u: Unit, x: number, y: number) {
  const a = u.activity
  if (!a) return
  const z = 55
  if (a.kind === 'needs-you') {
    const s = a.detail?.startsWith('question') ? question : alert
    items.push({ kind: 'sprite', sprite: s, x: x + 9, y: y - 20, z, anim: { bob: { amp: 1, ms: 500 } } })
  } else if (a.kind === 'waiting-agent') {
    items.push({ kind: 'sprite', sprite: hourglass, x: x + 9, y: y - 20, z })
  } else if (a.kind === 'thinking') {
    items.push({ kind: 'sprite', sprite: thought[0]!, x: x + 9, y: y - 17, z, anim: { frames: thought, frameMs: 350 } })
  }
}

function shells(items: Drawable[], u: Unit, x: number, y: number) {
  const live = (u.shells ?? []).filter(s => s.state === 'running' || s.state === 'background')
  live.slice(0, 2).forEach((sh, i) => {
    const frames = sh.state === 'running' ? shellRunning : shellBackground
    const mx = x + i * 12
    items.push({ kind: 'sprite', sprite: frames[0]!, x: mx, y, z: 42, anim: { frames, frameMs: 260 } })
  })
  const first = live[0]
  if (first) {
    const room = 14 - Math.min(2, live.length) * 3
    const cmd = first.command.length > room ? first.command.slice(0, room - 1) + '…' : first.command
    items.push({ kind: 'text', x: x + Math.min(2, live.length) * 12 + 1, y: y + 6, text: `$ ${cmd}`, color: first.state === 'running' ? C.lime : C.orange, z: 45, size: 0.75 })
  }
}

function camp(items: Drawable[], spots: Record<string, Pt>, u: Unit, cx: number, cy: number, team: readonly [Rgb, Rgb], roadY: number, bi: number) {
  const left = Math.max(0, u.total - u.done)
  const z = 30 + cy / 1000
  // Trampled ground, and a track down to the road.
  items.push({ kind: 'rect', x: cx - 4, y: cy + 14, w: CAMP_W - 4, h: 22, color: C.grassDark, z: 4 })
  items.push({ kind: 'rect', x: cx - 2, y: cy + 12, w: CAMP_W - 8, h: 26, color: C.grassDark, z: 4 })
  items.push({ kind: 'rect', x: cx + 2, y: cy + 16, w: CAMP_W - 16, h: 18, color: C.dirtDark, z: 4.1 })
  items.push({ kind: 'rect', x: cx + 4, y: cy + 17, w: CAMP_W - 20, h: 16, color: C.dirt, z: 4.2 })
  const trackTop = Math.min(cy + 34, roadY)
  const trackH = Math.abs(roadY - (cy + 34)) + 2
  items.push({ kind: 'rect', x: cx + 2, y: trackTop, w: 3, h: trackH, color: C.dirt, z: 4 })
  // Tent and fire.
  items.push({ kind: 'sprite', sprite: tent, x: cx + 26, y: cy + 4, z })
  if (left > 0) items.push({ kind: 'sprite', sprite: fire[0]!, x: cx + 20, y: cy + 16, z: z + 0.001, anim: { frames: fire, frameMs: 160 } })
  else items.push({ kind: 'sprite', sprite: victoryFlag, x: cx + 44, y: cy + 2, z: z + 0.002 })
  // Graves for the fallen (finished items).
  for (let i = 0; i < Math.min(u.done, 8); i++) {
    items.push({ kind: 'sprite', sprite: grave, x: cx + 26 + (i % 4) * 5, y: cy + 22 + Math.floor(i / 4) * 5, z: z + 0.002 })
  }
  // Goblins for the remaining items: the front one takes the hits.
  const shown = Math.min(left, 6)
  const fighting = u.status === 'running'
  for (let i = 0; i < shown; i++) {
    const g = goblin(i + bi)
    const gx = cx + 12 + (i % 3) * 10 + (i >= 3 ? 5 : 0)
    const gy = cy + 18 + (i >= 3 ? 10 : 0) + (i % 2) * 2
    const front = i === 0 && fighting
    items.push({
      kind: 'sprite', sprite: g.a, x: gx, y: gy, z: z + 0.01 + gy / 10000,
      anim: front ? { frames: [g.a, g.flash, g.b, g.b], frameMs: 150 } : { frames: [g.a, g.b], frameMs: 420 + i * 40, bob: { amp: 1, ms: 700 + i * 90, phase: i * 0.3 } },
    })
  }
  if (left > shown) items.push({ kind: 'text', x: cx + 46, y: cy + 46, text: `+${left - shown}`, color: C.red, z: 45, size: 0.8 })
  // Camp strength.
  items.push({ kind: 'bar', x: cx + 12, y: cy + 1, w: 40, p: u.total ? left / u.total : 0, color: C.red, z: 44 })

  // The knight.
  const k = knight(armourOf(u.model), team)
  const kx = cx - 6
  const ky = cy + 18
  spots[u.id] = [kx + 8, ky + 4]
  const kz = z + 0.02
  if (u.status === 'running') {
    items.push({ kind: 'sprite', sprite: k.ready, x: kx, y: ky, z: kz, unit: u.id, anim: { frames: [k.ready, k.strike, k.strike, k.ready], frameMs: 150 } })
    items.push({ kind: 'rect', x: kx + 17, y: ky + 6, w: 1, h: 1, color: C.yellow, z: 50, anim: { blink: { ms: 600, phase: 0.25 } } })
    items.push({ kind: 'rect', x: kx + 18, y: ky + 9, w: 1, h: 1, color: C.white, z: 50, anim: { blink: { ms: 600, phase: 0.3 } } })
  } else if (u.status === 'failed') {
    items.push({ kind: 'sprite', sprite: fallen(k.ready), x: kx, y: ky, z: kz, unit: u.id })
  } else {
    items.push({ kind: 'sprite', sprite: k.ready, x: kx, y: ky, z: kz, unit: u.id, anim: { bob: { amp: 1, ms: 1600 } } })
    if (u.status === 'waiting') {
      for (let i = 0; i < 3; i++) items.push({ kind: 'rect', x: kx + 12 + i * 2, y: ky - 4, w: 1, h: 1, color: C.white, z: 50, anim: { blink: { ms: 900, phase: i * 0.2 } } })
    }
  }
  items.push({ kind: 'bar', x: kx + 1, y: ky - 3, w: 14, p: u.total ? u.done / u.total : 0, color: C.lime, z: 46 })
  pips(items, u, kx + 3, ky - 6)
  if (u.isHero) crown(items, kx + 5, ky - 10)
  label(items, u, kx + 8, ky + 22)
  overhead(items, u, kx, ky)
  shells(items, u, kx - 2, ky + 26)
}

function reserve(items: Drawable[], spots: Record<string, Pt>, u: Unit, x: number, y: number, team: readonly [Rgb, Rgb], roadY: number, gate: Pt, bridgeEnd: number) {
  const k = knight(armourOf(u.model), team)
  const z = 35 + y / 1000
  spots[u.id] = [x + 8, y + 6]
  if (u.status === 'running') {
    // No work list: patrol the road to the bridge and back.
    const pts: Pt[] = [[gate[0] + 4, roadY - 14], [bridgeEnd, roadY - 14], [gate[0] + 4, roadY - 14]]
    items.push({ kind: 'sprite', sprite: k.walk, x: pts[0]![0], y: pts[0]![1], z: 48, unit: u.id, anim: { path: { pts, ms: 9000 }, frames: [k.walk, k.ready], frameMs: 220 } })
    spots[u.id] = [x + 8, y + 6]
  } else {
    const s = u.status === 'failed' ? fallen(k.ready) : k.ready
    items.push({ kind: 'sprite', sprite: s, x, y, z, unit: u.id, anim: u.status === 'done' || u.status === 'idle' ? { bob: { amp: 1, ms: 2000 } } : undefined })
    if (u.status === 'waiting') {
      for (let i = 0; i < 3; i++) items.push({ kind: 'rect', x: x + 12 + i * 2, y: y - 4, w: 1, h: 1, color: C.white, z: 50, anim: { blink: { ms: 900, phase: i * 0.2 } } })
    }
  }
  pips(items, u, x + 3, y - 4)
  if (u.isHero) crown(items, x + 5, y - 8)
  if (u.status !== 'running') label(items, u, x + 8, y + 22)
  overhead(items, u, x, y)
  shells(items, u, x - 2, y + 26)
}
