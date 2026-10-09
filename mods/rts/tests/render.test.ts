import { expect, test } from 'claude-code/testing'

import { demoWorld } from '../hooks/demo'
import { toCells } from '../hooks/raster'
import { layout } from '../hooks/scene'
import { toSvg } from '../hooks/svg'

test('the desktop map fits the Svg limit at every width', () => {
  for (const width of [300, 400, 520, 640]) {
    const svg = toSvg(layout(demoWorld(0), width), { minimap: true })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.length).toBeLessThan(131072)
  }
})

test('the terminal map is two pixels per cell', () => {
  const scene = layout(demoWorld(0), 120)
  const frame = toCells(scene, 500)
  expect(frame.columns).toBe(120)
  expect(frame.rows).toBe(Math.ceil(scene.h / 2))
  // three u32 per cell, base64
  expect(frame.cells.length).toBe(Math.ceil((frame.columns * frame.rows * 12) / 3) * 4)
})

test('every agent has a place messages can fly to', () => {
  const world = demoWorld(0)
  const scene = layout(world, 320)
  for (const b of world.bases) for (const u of b.units) expect(scene.spots[u.id]).toBeDefined()
})
