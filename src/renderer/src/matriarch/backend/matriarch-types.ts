// Portal-facing domain types. These are the shapes the UI renders — deliberately
// decoupled from any backend's raw row schema (Orca's TaskRow, AgentStatusEntry,
// etc.). An adapter maps its backend onto these; no UI component imports a
// backend SDK or a backend's native types directly (PRD NFR7 / §4.4).

/** Task lifecycle, in board-column order is derived elsewhere — this is the raw set. */
export type TaskStatus = 'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'

/** Live agent state (4 reported) + the decayed `idle` the portal derives after a TTL. */
export type AgentState = 'working' | 'blocked' | 'waiting' | 'done' | 'idle'

export type GateStatus = 'pending' | 'resolved' | 'timeout'

export type CoordinatorRunStatus = 'idle' | 'running' | 'completed' | 'failed'

export type MessageType =
  | 'status'
  | 'dispatch'
  | 'worker_done'
  | 'merge_ready'
  | 'escalation'
  | 'handoff'
  | 'decision_gate'
  | 'heartbeat'

export type MessagePriority = 'normal' | 'high' | 'urgent'

/**
 * One agent/terminal handle. Cards lead with `label` (a human-readable name —
 * the title of the dispatched task, or a fallback); the opaque `handle` is
 * secondary. `state` is what the UI colors on.
 */
export type AgentSnapshot = {
  /** Opaque terminal handle (monospace, shown small in the card foot). */
  handle: string
  /** Stable pane identity `${tabId}:${leafId}` — used for lineage + dedup keys. */
  paneKey: string
  /** Human-readable name: the dispatched task's title, else a sensible fallback. */
  label: string
  state: AgentState
  agentType?: string
  /** The user's most recent prompt for this pane. */
  prompt: string
  /** Tool the agent is currently using (working state), e.g. "Edit". */
  toolName?: string
  /** Short preview of the tool input, e.g. a file path or command. */
  toolInput?: string
  /** Most recent assistant message preview (shown when not actively tool-using). */
  lastAssistantMessage?: string
  /** ms epoch when the current state began (drives the "3m ago" label + TTL decay). */
  stateStartedAt: number
  /** ms epoch of the last update for this pane. */
  updatedAt: number
  /** True when this handle is the coordinator ("the matriarch"). */
  isCoordinator: boolean
  /** Linked task id when this agent is working a dispatched task. */
  taskId?: string
  dispatchId?: string
  /** Parent handle for lineage (children indent under the coordinator). */
  parentHandle?: string
  parentPaneKey?: string
  coordinatorHandle?: string
  runId?: string
  /** Worktree association when present; absent for shell/main/SSH terminals. */
  worktreeId?: string
  /** Human worktree name (folder leaf) for display, derived from worktreeId. */
  worktreeName?: string
}

/**
 * A terminal/pane summary for the unified Board's cards + Parked column. Distinct
 * from `TerminalHandle` (the reserved R2 dispatch-target shape) — this is the
 * read-only display projection of the runtime's `terminal.list`, covering ALL
 * terminals across worktrees including plain shells with no agent.
 */
export type TerminalSummary = {
  /** Opaque terminal handle; joins Task.assigneeHandle / AgentSnapshot.handle. */
  handle: string
  /** Stable pane identity `${tabId}:${leafId}`; joins AgentSnapshot.paneKey. */
  paneKey: string
  /** Human worktree name (folder leaf), derived from the runtime worktree id. */
  worktreeName?: string
  /** Branch checked out in the terminal's worktree, when known. */
  branch?: string
  /** Terminal title/label, when set. */
  title?: string
  /** Whether a live PTY is currently attached. */
  connected: boolean
  /** ms epoch of last output (relative-time label); null when never produced. */
  lastOutputAt: number | null
  /** Short last-output preview, when non-empty. */
  preview?: string
  /** Agent-set one-line "what I'm working on" note for this pane (terminal.setNote). */
  note?: string
  /** True when a live foreground process (≠ the shell) is running in the pane. The
   *  Board treats this as "working" even when the pane's agent reports done. */
  hasRunningProcess?: boolean
}

/**
 * A task (DAG node). `title` is derived (TaskRow carries only `spec`); the UI
 * leads with it. `deps` are resolved task ids. Dispatch + failure context is
 * folded in when the backend exposes it.
 */
export type Task = {
  id: string
  /** Derived short title (first line / truncated spec). */
  title: string
  /** Full spec (detail body). */
  spec: string
  status: TaskStatus
  parentId?: string
  /** Resolved dependency task ids (DAG edges). */
  deps: string[]
  result?: string
  /** Assignee handle when dispatched. */
  assigneeHandle?: string
  dispatchId?: string
  /** Failure budget, e.g. "3/3" when circuit-broken — present only when > 0. */
  attempts?: string
  createdAt?: string
  completedAt?: string
  startedAt?: string
}

/** Full task context for the detail Sheet. */
export type TaskDetail = Task & {
  /** Ordered status history rows for the timeline (best-effort; may be derived). */
  history: TaskHistoryEntry[]
  /** Gate blocking this task, if any. */
  gate?: Gate
  /** Messages related to this task/dispatch/thread. */
  relatedMessages: Message[]
}

export type TaskHistoryEntry = {
  status: TaskStatus | 'dispatched-to'
  label: string
  /** Display time, may be empty when unknown. */
  time: string
}

export type Gate = {
  id: string
  taskId: string
  question: string
  options: string[]
  status: GateStatus
  resolution?: string
  /** Handle the gate is waiting on. */
  toHandle?: string
  createdAt?: string
  resolvedAt?: string
}

export type Message = {
  id: string
  fromHandle: string
  toHandle: string
  type: MessageType
  priority: MessagePriority
  body: string
  subject?: string
  threadId?: string
  sequence?: number
  createdAt?: string
}

/** Derived coordinator state: there is no coordinator-status RPC; infer it. */
export type CoordinatorState = {
  status: CoordinatorRunStatus
  /** Coordinator terminal handle, when known. */
  handle?: string
  runId?: string
  spec?: string
  pollIntervalMs?: number
  /** Counts by task status for the summary line. */
  counts: Record<TaskStatus, number>
  /** Number of currently-dispatched tasks. */
  activeDispatches: number
}

/** Dispatch target candidate (R2 — terminal picker). */
export type TerminalHandle = {
  handle: string
  title?: string
  worktreeId?: string
  /** Whether an agent is running here (inject-eligibility). Probed lazily. */
  agentEligible?: boolean
}

export type TaskFilter = {
  status?: TaskStatus
  runId?: string
}

export type InboxFilter = {
  /** Match either from or to. */
  handle?: string
  type?: MessageType
}
