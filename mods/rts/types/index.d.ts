// The rts mod's state contract: what the battlefield shows, plain JSON data.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type UnitStatus = 'running' | 'waiting' | 'idle' | 'done' | 'failed'

/** What an agent is doing right now. */
export type Activity = {
  kind: 'thinking' | 'tool' | 'shell' | 'needs-you' | 'waiting-agent'
  /** A tool name, a command, what is being asked, or whom it waits on. */
  detail?: string
  since: number
}

/** A shell command an agent started. */
export type Shell = {
  id: string
  command: string
  state: 'running' | 'background' | 'ok' | 'failed'
  startedAt: number
  endedAt?: number
}

/** One agent: a knight. */
export type Unit = {
  id: string
  name: string
  /** As the API reports it, e.g. claude-opus-5-5. */
  model: string
  effort?: Effort
  status: UnitStatus
  /** The session's main loop. */
  isHero?: boolean
  tokens: number
  usd: number
  /** Work items finished: goblins slain. */
  done: number
  /** Work items known. */
  total: number
  /** The item in progress. */
  current?: string
  activity?: Activity
  /** Running shells first, then the last few finished. */
  shells?: Shell[]
}

/** One session: a castle. */
export type Base = {
  id: string
  name: string
  tokens: number
  usd: number
  updatedAt: number
  units: Unit[]
}

/** A message between agents or sessions. */
export type Letter = {
  id: string
  from: string
  to: string
  text: string
  at: number
}

export type World = {
  bases: Base[]
  letters: Letter[]
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    rts: {
      world: World
      selected: string | null
      isDemo: boolean
    }
  }
}
