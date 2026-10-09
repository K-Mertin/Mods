// What the battlefield shows: sessions (headquarters), agents (knights), their work (goblin camps)
// and the letters between them. Plain data, so it can cross sessions as JSON.

import type { World } from '../types'

export type { Activity, Base, Effort, Letter, Shell, Unit, UnitStatus, World } from '../types'

export function totals(world: World) {
  let tokens = 0
  let usd = 0
  let units = 0
  let done = 0
  let total = 0
  for (const b of world.bases) {
    tokens += b.tokens
    usd += b.usd
    units += b.units.length
    for (const u of b.units) {
      done += u.done
      total += u.total
    }
  }
  return { tokens, usd, units, done, total, sessions: world.bases.length }
}
