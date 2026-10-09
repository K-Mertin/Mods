// Pixel art for the battlefield. Sprites are rows of palette characters, '.' transparent.
// Palette after Sweetie 16, extended with grass, wood and team shades.

export type Rgb = number
export type Sprite = { readonly w: number; readonly h: number; readonly px: readonly (Rgb | null)[] }

export const C = {
  ink: 0x1a1c2c, plum: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, yellow: 0xffcd75,
  lime: 0xa7f070, green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9,
  sky: 0x41a6f6, cyan: 0x73eff7, white: 0xf4f4f4, silver: 0x94b0c2, slate: 0x566c86, night: 0x333c57,
  grass: 0x3e8948, grassLight: 0x5aa85e, grassDark: 0x2d6b3a, dirt: 0x9c6b43, dirtDark: 0x7a5233,
  wood: 0x73472c, woodDark: 0x4a2e1d, skin: 0xf4c7a1, canvas: 0xd9b382, canvasDark: 0x9e7a52,
  stone: 0xa6a6b4, stoneLight: 0xc9c9d4, stoneDark: 0x6e6e80,
  gold: 0xffcd75, goldMid: 0xe8a33d, goldDark: 0xa0662a,
  leather: 0xc48a5a, leatherMid: 0x8f5f3a, leatherDark: 0x5a3a24,
  gob: 0x8bc34a, gobDark: 0x4e7a2a, gobLight: 0xb9e07a,
} as const

// Team colours, one per session: [main, dark].
export const TEAMS: readonly (readonly [Rgb, Rgb])[] = [
  [0x3b5dc9, 0x29366f], [0xb13e53, 0x5d275d], [0xef7d57, 0xa0462a], [0x38b764, 0x257179],
  [0x9b59d0, 0x5d275d], [0x41a6f6, 0x29366f], [0xffcd75, 0xa0662a], [0xf4f4f4, 0x566c86],
]

type Key = Record<string, Rgb | undefined>

export function sprite(rows: readonly string[], key: Key): Sprite {
  const w = Math.max(...rows.map(r => r.length))
  const px: (Rgb | null)[] = []
  for (const row of rows) {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '.'
      px.push(ch === '.' ? null : (key[ch] ?? null))
    }
  }
  return { w, h: rows.length, px }
}

// ── Knight (agent), facing right. A/B: armour light/mid/dark, P/p: plume, T/t: team tabard.
const KNIGHT_READY = [
  '......PP........',
  '.....PPp.....K..',
  '....KKKK....KWK.',
  '...KAABBK...KWK.',
  '...KAKKKK..KWwK.',
  '...KABBBDK.KWK..',
  '....KDDDK.KWwK..',
  '...KTTTTTKHHK...',
  '..KBTTtTTKhK....',
  '..KBTTtTTTK.....',
  '...KTTtTTK......',
  '...KDKKKDK......',
  '...KBK.KBK......',
  '...KBK.KBK......',
  '..KooK.KooK.....',
  '..KKKK.KKKK.....',
]
const KNIGHT_STRIKE = [
  '......PP........',
  '.....PPp........',
  '....KKKK........',
  '...KAABBK.......',
  '...KAKKKK.......',
  '...KABBBDK......',
  '....KDDDK.......',
  '...KTTTTTKKKKKKK',
  '..KBTTtTTHWWWWwK',
  '..KBTTtTTKKKKKKK',
  '...KTTtTTK......',
  '...KDKKKDK......',
  '..KBK...KBK.....',
  '.KBK.....KBK....',
  'KooK.....KooK...',
  'KKK.......KKK...',
]
const KNIGHT_WALK = [
  '......PP........',
  '.....PPp.....K..',
  '....KKKK....KWK.',
  '...KAABBK...KWK.',
  '...KAKKKK..KWwK.',
  '...KABBBDK.KWK..',
  '....KDDDK.KWwK..',
  '...KTTTTTKHHK...',
  '..KBTTtTTKhK....',
  '..KBTTtTTTK.....',
  '...KTTtTTK......',
  '...KDKKKDK......',
  '....KBKBK.......',
  '....KBKBK.......',
  '...KooKooK......',
  '...KKKKKKK......',
]

export type Armour = 'gold' | 'steel' | 'leather' | 'violet'

const ARMOUR: Record<Armour, { A: Rgb; B: Rgb; D: Rgb; P: Rgb; p: Rgb }> = {
  gold: { A: C.gold, B: C.goldMid, D: C.goldDark, P: C.red, p: C.plum },
  steel: { A: C.white, B: C.silver, D: C.slate, P: C.sky, p: C.blue },
  leather: { A: C.leather, B: C.leatherMid, D: C.leatherDark, P: C.lime, p: C.green },
  violet: { A: 0xd9b8f0, B: 0x9b59d0, D: 0x5d275d, P: C.cyan, p: C.teal },
}

const knights = new Map<string, ReturnType<typeof makeKnight>>()

export function knight(armour: Armour, team: readonly [Rgb, Rgb]) {
  const id = `${armour}:${team[0]}`
  let k = knights.get(id)
  if (!k) knights.set(id, (k = makeKnight(armour, team)))
  return k
}

function makeKnight(armour: Armour, team: readonly [Rgb, Rgb]) {
  const a = ARMOUR[armour]
  const key: Key = {
    K: C.ink, A: a.A, B: a.B, D: a.D, P: a.P, p: a.p, T: team[0], t: team[1],
    W: C.white, w: C.silver, H: C.wood, h: C.woodDark, o: C.night,
  }
  return {
    ready: sprite(KNIGHT_READY, key),
    strike: sprite(KNIGHT_STRIKE, key),
    walk: sprite(KNIGHT_WALK, key),
  }
}

// ── Goblin (one remaining work item), facing left.
const GOBLIN_A = [
  '..............',
  '.K..........K.',
  'KLK..KKKK..KLK',
  'KLLKKLLLLKKLLK',
  '.KLLLLLLLLLLK.',
  '.KLLYKLLYKLLK.',
  '.KLLLLLLLLLLK.',
  '..KLLWKKWLLK..',
  'KK.KVVVVVVK...',
  'KwKLKVVVVKLK..',
  'Kw.KKVVVVKK...',
  'Kw..KdK.KdK...',
  'Kw..KK...KK...',
]
const GOBLIN_B = [
  '.K..........K.',
  'KLK..KKKK..KLK',
  'KLLKKLLLLKKLLK',
  '.KLLLLLLLLLLK.',
  '.KLLYKLLYKLLK.',
  '.KLLLLLLLLLLK.',
  '..KLLWWWWLLK..',
  'KK.KKKKKKKK...',
  'KwKLKVVVVKLK..',
  'Kw.KKVVVVKK...',
  'Kw..KVVVVK....',
  'Kw.KdK..KdK...',
  'Kw.KK....KK...',
]

const goblins = new Map<number, ReturnType<typeof makeGoblin>>()

export function goblin(variant: number) {
  const v = variant % 3
  let g = goblins.get(v)
  if (!g) goblins.set(v, (g = makeGoblin(v)))
  return g
}

function makeGoblin(variant: number) {
  const vest = [C.woodDark, C.plum, C.night][variant % 3]!
  const key: Key = {
    K: C.ink, L: C.gob, Y: C.yellow, W: C.white, V: vest, d: C.gobDark, w: C.wood,
  }
  const a = sprite(GOBLIN_A, key)
  const hit = sprite(GOBLIN_A, { ...key, L: C.gobLight, V: C.red, Y: C.white })
  return { a, b: sprite(GOBLIN_B, key), flash: hit }
}

// ── Camp: a tent flying the enemy flag.
const TENT = [
  '........K.........',
  '........KRRR......',
  '........KRRRR.....',
  '........KRR.......',
  '........K.........',
  '.......KhK........',
  '......KhHhK.......',
  '.....KhHhHhK......',
  '....KhHhHhHhK.....',
  '...KhHhHhHhHhK....',
  '..KhHhHKKKhHhHK...',
  '.KhHhHKddddKhHhK..',
  'KhHhHhKddddKhHhHK.',
  'KKKKKKKKKKKKKKKKK.',
]
export const tent = sprite(TENT, { K: C.ink, R: C.red, h: C.canvasDark, H: C.canvas, d: C.ink })

const FIRE = [
  [
    '...Y....',
    '..YOY...',
    '..YROY..',
    '.YORRY..',
    '.KwwwK..',
    'KwKwKwK.',
  ],
  [
    '....Y...',
    '...YOY..',
    '..YORY..',
    '..YRROY.',
    '.KwwwK..',
    'KwKwKwK.',
  ],
  [
    '..Y.....',
    '..YY.Y..',
    '.YOROY..',
    '.YRRRY..',
    '.KwwwK..',
    'KwKwKwK.',
  ],
]
export const fire = FIRE.map(f => sprite(f, { Y: C.yellow, O: C.orange, R: C.red, K: C.ink, w: C.wood }))

// ── Scenery.
export const tree = sprite(
  [
    '....KKKK....',
    '..KKLLLgKK..',
    '.KLLLLLLgLK.',
    'KLLgLLLLLggK',
    'KLLLLLLgLLgK',
    'KgLLLLLLLggK',
    '.KggLLLggggK',
    '..KKggggKKK.',
    '....KwwK....',
    '....KwwK....',
    '...KwwwwK...',
  ],
  { K: C.ink, L: C.green, g: C.teal, w: C.wood },
)
export const pine = sprite(
  [
    '....K....',
    '...KLK...',
    '..KLLgK..',
    '...KgK...',
    '..KLLLK..',
    '.KLLLggK.',
    '..KLgK...',
    '.KLLLLgK.',
    'KLLLLLggK',
    'KKKKwKKKK',
    '...KwK...',
  ],
  { K: C.ink, L: C.green, g: C.teal, w: C.wood },
)
export const rock = sprite(['.KKKK.', 'KSSsKK', 'KSsssK', 'KKKKKK'], { K: C.ink, S: C.stoneLight, s: C.stoneDark })
export const flower = sprite(['.Y.', 'YRY', '.g.'], { Y: C.yellow, R: C.red, g: C.teal })
export const tuft = sprite(['g.g', '.g.'], { g: C.grassLight })

// ── Courier: a sealed letter.
export const letter = sprite(
  ['KKKKKKK', 'KWwwwWK', 'KwWRWwK', 'KwwWwwK', 'KKKKKKK'],
  { K: C.ink, W: C.white, w: C.silver, R: C.red },
)

// ── Grave left where a goblin fell (a finished item).
export const grave = sprite(['.KK.', 'KSSK', 'KSsK', 'KKKK'], { K: C.ink, S: C.stoneLight, s: C.stoneDark })
export const victoryFlag = sprite(
  ['K....', 'KTTT.', 'KTTTT', 'KTT..', 'K....', 'K....', 'K....'],
  { K: C.ink, T: C.yellow },
)

// ── Status bubbles over an agent's head.
const BUBBLE = (glyph: string[]) => [
  '.KKKKKKK.',
  'KWWWWWWWK',
  ...glyph.map(r => 'KW' + r + 'WK'),
  'KWWWWWWWK',
  '.KKWKKKK.',
  '..KK.....',
]
export const alert = sprite(BUBBLE(['WWOWW', 'WWOWW', 'WWOWW', 'WWWWW', 'WWOWW']), { K: C.ink, W: C.yellow, O: C.ink })
export const question = sprite(BUBBLE(['WOOOW', 'WWWOW', 'WWOOW', 'WWWWW', 'WWOWW']), { K: C.ink, W: C.cyan, O: C.ink })
export const hourglass = sprite(BUBBLE(['OOOOO', 'WOYOW', 'WWOWW', 'WOYOW', 'OOOOO']), { K: C.ink, W: C.white, O: C.slate, Y: C.yellow })
export const thought = [0, 1, 2].map(n =>
  sprite(
    ['.KKKKKKK.', 'KWWWWWWWK', 'KW' + [0, 1, 2].map(i => (i <= n ? 'OW' : 'WW')).join('').slice(0, 5) + 'WK', 'KWWWWWWWK', '.KKKKKKK.', '...KK....', '....K....'],
    { K: C.ink, W: C.white, O: C.slate },
  ),
)

// ── A shell: a little terminal on a stand. Screen glyph rows swap to blink the cursor.
const MONITOR = (screen: [string, string]) => [
  'KKKKKKKKKK',
  'KSSSSSSSSK',
  'KS' + screen[0] + 'SK',
  'KS' + screen[1] + 'SK',
  'KSSSSSSSSK',
  'KKKKKKKKKK',
  '....KK....',
  '..KKKKKK..',
]
const screenKey = { K: C.ink, S: C.night, G: C.lime, g: C.green, A: C.orange, d: C.ink }
export const shellRunning = [
  sprite(MONITOR(['GddddG', 'gGGddd']), screenKey),
  sprite(MONITOR(['GddddG', 'gGGGdd']), screenKey),
  sprite(MONITOR(['GddddG', 'gGGddd']), screenKey),
  sprite(MONITOR(['GddddG', 'gGdddd']), screenKey),
]
export const shellBackground = [
  sprite(MONITOR(['ddddAd', 'gGGddd']), screenKey),
  sprite(MONITOR(['dddddd', 'gGGddd']), screenKey),
]
