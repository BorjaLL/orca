// Beat timings — slow enough to read at a glance.
export const BUBBLE_FLIGHT_MS = 1600
export const BUBBLE_LAND_MS = BUBBLE_FLIGHT_MS + 360
export const BUBBLE_GAP_MS = 3400
export const SPAWN_CREATING_MS = 1800

export type AgentKey = 'coord-claude' | 'child-codex' | 'spawned-claude' | 'spawned-codex'

export type Beat = {
  from: AgentKey
  to: AgentKey
  recipientMsg?: string
  coordMsg?: string
  // The "send" *is* the "finish" — flipping the spinner to a check the
  // moment the bubble departs reads as the agent wrapping up and reporting
  // back to the orchestrator.
  senderFinishes?: boolean
}

export const PHASE1_BEATS: readonly Beat[] = [
  {
    from: 'coord-claude',
    to: 'child-codex',
    recipientMsg: 'Adding the email_verified column…'
  },
  {
    from: 'child-codex',
    to: 'coord-claude',
    coordMsg: 'PR 2/4 ready — moving to PR 3/4',
    senderFinishes: true
  }
]

export const PHASE2_BEATS: readonly Beat[] = [
  {
    from: 'coord-claude',
    to: 'spawned-claude',
    recipientMsg: 'Picking up — scanning logs'
  },
  {
    from: 'coord-claude',
    to: 'spawned-codex',
    recipientMsg: 'On the fixes — patching now'
  },
  {
    from: 'spawned-codex',
    to: 'coord-claude',
    coordMsg: 'Codex: patch ready',
    senderFinishes: true
  }
]

export const COORD_INITIAL_MSG = 'Splitting auth rewrite into 4 PRs…'
export const CHILD_INITIAL_MSG = 'Writing the users table migration…'
export const SPAWNED_CLAUDE_INITIAL_MSG = 'Picking up — scanning logs…'
export const SPAWNED_CODEX_INITIAL_MSG = 'Drafting fixes…'

export type AgentRowState = 'working' | 'done'

export type RowState = Record<AgentKey, AgentRowState>
export type RowMessages = Record<AgentKey, string>
export type RowFlash = Partial<Record<AgentKey, number>>
export type RowPending = Partial<Record<AgentKey, boolean>>

export const INITIAL_ROW_STATE: RowState = {
  'coord-claude': 'working',
  'child-codex': 'working',
  'spawned-claude': 'working',
  'spawned-codex': 'working'
}

export const INITIAL_ROW_MESSAGES: RowMessages = {
  'coord-claude': COORD_INITIAL_MSG,
  'child-codex': CHILD_INITIAL_MSG,
  'spawned-claude': SPAWNED_CLAUDE_INITIAL_MSG,
  'spawned-codex': SPAWNED_CODEX_INITIAL_MSG
}

export type Phase = 1 | 2
export type SpawnState = 'hidden' | 'creating' | 'ready'
