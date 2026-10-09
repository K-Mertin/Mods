// Draws a Scene as one SVG: sprites defined once and placed with <use>, animated with SMIL,
// so the desktop animates it with no work from the plugin between data changes.

import { C, type Rgb, type Sprite } from './art'
import type { Anim, Drawable, Scene } from './scene'

const hex = (c: Rgb) => '#' + c.toString(16).padStart(6, '0')

function spritePaths(s: Sprite): string {
  const byColor = new Map<Rgb, string>()
  for (let y = 0; y < s.h; y++) {
    let x = 0
    while (x < s.w) {
      const c = s.px[y * s.w + x]
      if (c === null || c === undefined) {
        x++
        continue
      }
      let run = 1
      while (x + run < s.w && s.px[y * s.w + x + run] === c) run++
      byColor.set(c, (byColor.get(c) ?? '') + `M${x} ${y}h${run}v1h-${run}z`)
      x += run
    }
  }
  return [...byColor].map(([c, d]) => `<path fill="${hex(c)}" d="${d}"/>`).join('')
}

function esc(t: string) {
  return t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
}

function discrete(slots: number, on: (i: number) => boolean) {
  const values: string[] = []
  const times: string[] = []
  for (let i = 0; i < slots; i++) {
    values.push(on(i) ? 'visible' : 'hidden')
    times.push((i / slots).toFixed(4))
  }
  return `values="${values.join(';')}" keyTimes="${times.join(';')}"`
}

export function toSvg(scene: Scene, opts: { minimap?: boolean } = {}): string {
  const ids = new Map<Sprite, string>()
  const defs: string[] = []
  const use = (s: Sprite) => {
    let id = ids.get(s)
    if (!id) {
      id = `s${ids.size}`
      ids.set(s, id)
      defs.push(`<g id="${id}">${spritePaths(s)}</g>`)
    }
    return id
  }

  const body: string[] = []
  for (const d of scene.items) body.push(draw(d, use))

  const { w, h } = scene
  const mini = opts.minimap ? minimap(scene) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 4}" height="${h * 4}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="background:${hex(C.grassDark)}" shape-rendering="crispEdges" font-family="ui-monospace,Menlo,monospace">
<defs>
<pattern id="grass" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="${hex(C.grass)}"/><path fill="${hex(C.grassLight)}" d="M2 3h1v1h-1zM9 1h1v1h-1zM13 9h1v1h-1zM5 12h1v1h-1zM11 14h1v1h-1z"/><path fill="${hex(C.grassDark)}" d="M6 6h1v1h-1zM14 3h1v1h-1zM1 10h1v1h-1zM10 7h1v1h-1z"/></pattern>
<radialGradient id="fog" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#0b0d14" stop-opacity="0"/><stop offset="100%" stop-color="#0b0d14" stop-opacity="0.65"/></radialGradient>
${defs.join('\n')}
</defs>
<rect width="${w}" height="${h}" fill="url(#grass)"/>
${body.join('\n')}
<rect width="${w}" height="${h}" fill="url(#fog)" pointer-events="none"/>
${mini}
</svg>`
}

function wrap(inner: string, x: number, y: number, a?: Anim): string {
  if (!a) return `<g transform="translate(${x} ${y})">${inner}</g>`
  let anims = ''
  if (a.bob) {
    const p = a.bob.phase ?? 0
    anims += `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 ${-a.bob.amp};0 0" dur="${a.bob.ms}ms" begin="${-p * a.bob.ms}ms" repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.5;1"/>`
  }
  if (a.blink) {
    const p = a.blink.phase ?? 0
    anims += `<animate attributeName="visibility" ${discrete(2, i => i === 0)} dur="${a.blink.ms}ms" begin="${-p * a.blink.ms}ms" repeatCount="indefinite" calcMode="discrete"/>`
  }
  if (a.path) {
    const d = 'M' + a.path.pts.map(([px, py]) => `${px} ${py}`).join('L')
    const begin = a.path.delay ? `${Math.round(a.path.delay)}ms` : '0s'
    return `<g><animateMotion path="${d}" dur="${a.path.ms}ms" begin="${begin}" repeatCount="indefinite" calcMode="linear"/>${anims ? `<g>${anims}${inner}</g>` : inner}</g>`
  }
  return `<g transform="translate(${x} ${y})">${anims}${inner}</g>`
}

function draw(d: Drawable, use: (s: Sprite) => string): string {
  switch (d.kind) {
    case 'rect': {
      const r = `<rect width="${d.w}" height="${d.h}" fill="${hex(d.color)}"/>`
      return wrap(r, d.x, d.y, d.anim)
    }
    case 'bar': {
      const fill = Math.round(d.w * Math.max(0, Math.min(1, d.p)))
      return `<g transform="translate(${d.x} ${d.y})"><rect x="-1" y="-1" width="${d.w + 2}" height="3" fill="${hex(C.ink)}"/><rect width="${d.w}" height="1" fill="${hex(C.night)}"/>${fill ? `<rect width="${fill}" height="1" fill="${hex(d.color)}"/>` : ''}</g>`
    }
    case 'text': {
      const size = (d.size ?? 1) * 5
      return `<text x="${d.x}" y="${d.y}" font-size="${size}" font-weight="700" text-anchor="${d.anchor ?? 'start'}" fill="${hex(d.color)}" stroke="${hex(C.ink)}" stroke-width="1" paint-order="stroke" shape-rendering="auto">${esc(d.text)}</text>`
    }
    case 'sprite': {
      const a = d.anim
      if (a?.frames && a.frames.length > 1) {
        const n = a.frames.length
        const ms = (a.frameMs ?? 200) * n
        const uses = a.frames
          .map((f, i) => `<use href="#${use(f)}" visibility="${i === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" ${discrete(n, j => j === i)} dur="${ms}ms" repeatCount="indefinite" calcMode="discrete"/></use>`)
          .join('')
        return wrap(uses, d.x, d.y, a)
      }
      return wrap(`<use href="#${use(d.sprite)}"/>`, d.x, d.y, a)
    }
  }
}

function minimap(scene: Scene): string {
  const mw = 40
  const mh = Math.round((scene.h / scene.w) * mw)
  const k = mw / scene.w
  const x0 = scene.w - mw - 3
  const y0 = scene.h - mh - 3
  const dots: string[] = []
  for (const d of scene.items) {
    if (d.kind !== 'sprite') continue
    if (d.sprite.w >= 50) dots.push(`<rect x="${(d.x * k).toFixed(1)}" y="${(d.y * k).toFixed(1)}" width="5" height="4" fill="${hex(C.yellow)}"/>`)
    else if (d.unit) dots.push(`<rect x="${(d.x * k).toFixed(1)}" y="${(d.y * k).toFixed(1)}" width="2" height="2" fill="${hex(C.cyan)}"/>`)
    else if (d.sprite.w === 18) dots.push(`<rect x="${(d.x * k).toFixed(1)}" y="${(d.y * k).toFixed(1)}" width="3" height="2" fill="${hex(C.red)}"/>`)
  }
  return `<g transform="translate(${x0} ${y0})" opacity="0.92"><rect x="-1" y="-1" width="${mw + 2}" height="${mh + 2}" fill="${hex(C.ink)}"/><rect width="${mw}" height="${mh}" fill="${hex(C.grassDark)}"/><rect x="${(scene.river.x * k).toFixed(1)}" width="${(scene.river.w * k).toFixed(1)}" height="${mh}" fill="${hex(C.blue)}"/>${dots.join('')}</g>`
}
