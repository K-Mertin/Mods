// Draws a Scene at time t into terminal cells: two pixels per cell ('▀', top as foreground,
// bottom as background), labels written as real characters over the pixels.

import { C, type Rgb, type Sprite } from './art'
import type { Anim, Drawable, Pt, Scene } from './scene'

export type Frame = { columns: number; rows: number; cells: string }

function grass(x: number, y: number): Rgb {
  const n = (x * 7 + y * 13 + ((x * y) % 5)) % 23
  return n === 0 ? C.grassLight : n === 7 ? C.grassDark : C.grass
}

function frameOf(a: Anim | undefined, base: Sprite, t: number): Sprite {
  if (!a?.frames || a.frames.length < 2) return base
  const i = Math.floor(t / (a.frameMs ?? 200)) % a.frames.length
  return a.frames[i] ?? base
}

function along(pts: readonly Pt[], u: number): Pt {
  const segs = pts.length - 1
  const f = u * segs
  const i = Math.min(segs - 1, Math.floor(f))
  const k = f - i
  const a = pts[i]!
  const b = pts[i + 1]!
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k)]
}

function place(d: { x: number; y: number; anim?: Anim }, t: number): Pt | null {
  const a = d.anim
  let x = d.x
  let y = d.y
  if (a?.path) {
    const delay = a.path.delay ?? 0
    if (t < delay) return null
    ;[x, y] = along(a.path.pts, ((t - delay) % a.path.ms) / a.path.ms)
  }
  if (a?.bob) {
    const ph = ((t / a.bob.ms + (a.bob.phase ?? 0)) % 1 + 1) % 1
    if (ph >= 0.5) y -= a.bob.amp
  }
  if (a?.blink) {
    const ph = ((t / a.blink.ms + (a.blink.phase ?? 0)) % 1 + 1) % 1
    if (ph >= 0.5) return null
  }
  return [x, y]
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

function shade(c: Rgb, k: number): Rgb {
  const r = ((c >> 16) & 255) * k
  const g = ((c >> 8) & 255) * k
  const b = (c & 255) * k
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

export function toCells(scene: Scene, t: number): Frame {
  const W = scene.w
  const H = scene.h + (scene.h % 2)
  const px = new Array<Rgb>(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = grass(x, y)

  const put = (x: number, y: number, c: Rgb) => {
    if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c
  }
  const labels: { x: number; y: number; text: string; color: Rgb; middle: boolean }[] = []

  for (const d of scene.items as Drawable[]) {
    if (d.kind === 'text') {
      labels.push({ x: d.x, y: d.y, text: d.text, color: d.color, middle: d.anchor === 'middle' })
      continue
    }
    if (d.kind === 'bar') {
      for (let i = -1; i <= d.w; i++) put(d.x + i, d.y, C.ink)
      const fill = Math.round(d.w * Math.max(0, Math.min(1, d.p)))
      for (let i = 0; i < d.w; i++) put(d.x + i, d.y, i < fill ? d.color : C.night)
      continue
    }
    const at = place(d, t)
    if (!at) continue
    if (d.kind === 'rect') {
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) put(at[0] + i, at[1] + j, d.color)
      continue
    }
    const s = frameOf(d.anim, d.sprite, t)
    for (let j = 0; j < s.h; j++) {
      for (let i = 0; i < s.w; i++) {
        const c = s.px[j * s.w + i]
        if (c !== null && c !== undefined) put(at[0] + i, at[1] + j, c)
      }
    }
  }

  // Fog at the edges.
  const cx = W / 2
  const cy = H / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / cx
      const dy = (y - cy) / cy
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r > 0.85) px[y * W + x] = shade(px[y * W + x]!, Math.max(0.45, 1 - (r - 0.85) * 1.2))
    }
  }

  const rows = H / 2
  const words = new Uint32Array(W * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < W; x++) {
      const n = (r * W + x) * 3
      words[n] = 0x2580
      words[n + 1] = px[2 * r * W + x]!
      words[n + 2] = px[(2 * r + 1) * W + x]!
    }
  }
  // Labels: real characters on the colour beneath them.
  for (const l of labels) {
    const r = Math.max(0, Math.min(rows - 1, Math.floor((l.y - 3) / 2)))
    const start = Math.round(l.middle ? l.x - l.text.length / 2 : l.x)
    for (let i = 0; i < l.text.length; i++) {
      const x = start + i
      if (x < 0 || x >= W) continue
      const n = (r * W + x) * 3
      const code = l.text.charCodeAt(i)
      words[n] = code >= 0x20 && code < 0xd800 ? code : 0x3f
      words[n + 1] = l.color
      words[n + 2] = shade(px[2 * r * W + x]!, 0.55)
    }
  }
  return { columns: W, rows, cells: base64(new Uint8Array(words.buffer)) }
}
