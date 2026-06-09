// Wire shapes for the Orca runtime RPC responses the portal reads. These mirror
// the JSON the runtime sends (snake_case rows), and live here — NOT imported
// from src/main — so the renderer bundle never depends on main-process modules.
// The adapter maps these onto the portal-facing types (matriarch-types.ts).

import type {
  AgentState,
  GateStatus,
  MessagePriority,
  MessageType,
  TaskStatus
} from '../matriarch-types'

/** Row from orchestration.taskList; dispatched rows add the joined dispatch fields. */
export type OrcaTaskRow = {
  id: string
  parent_id: string | null
  created_by_terminal_handle: string | null
  spec: string
  status: TaskStatus
  /** JSON-encoded string array of dependency task ids. */
  deps: string
  result: string | null
  created_at: string
  completed_at: string | null
  /** Present only on dispatched rows. */
  assignee_handle?: string | null
  dispatch_id?: string | null
}

export type OrcaTaskListResult = {
  tasks: OrcaTaskRow[]
  count: number
}

export type OrcaGateRow = {
  id: string
  task_id: string
  question: string
  /** JSON-encoded string array of options. */
  options: string
  status: GateStatus
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export type OrcaGateListResult = {
  gates: OrcaGateRow[]
  count: number
}

export type OrcaMessageRow = {
  id: string
  from_handle: string
  to_handle: string
  subject: string
  body: string
  type: MessageType
  priority: MessagePriority
  thread_id: string | null
  payload: string | null
  read: number
  sequence: number
  created_at: string
  delivered_at: string | null
}

export type OrcaInboxResult = {
  messages: OrcaMessageRow[]
  count: number
}

/** Row from terminal.list — used to resolve paneKey → handle for agent cards. */
export type OrcaTerminalSummary = {
  handle: string
  worktreeId: string
  worktreePath: string
  branch: string
  tabId: string
  leafId: string
  title: string | null
  connected: boolean
  writable: boolean
  lastOutputAt: number | null
  preview: string
  /** Agent-set "what I'm working on" note for this pane; empty when unset. */
  note: string
  /** True when a live foreground process (≠ the shell) is running in the pane.
   *  Optional for tolerance of older runtimes that don't send it. */
  hasRunningProcess?: boolean
}

export type OrcaTerminalListResult = {
  terminals: OrcaTerminalSummary[]
  totalCount: number
  truncated: boolean
}

/** status.get result (used as the connection probe). */
export type OrcaStatusResult = {
  runtimeId?: string
  [key: string]: unknown
}

/** Map an Orca agentStatus.state (working/blocked/waiting/done) to the portal's
 *  AgentState. `idle` is derived by the adapter via TTL decay, not reported. */
export function toAgentState(raw: string): AgentState {
  switch (raw) {
    case 'working':
    case 'blocked':
    case 'waiting':
    case 'done':
      return raw
    default:
      return 'idle'
  }
}
