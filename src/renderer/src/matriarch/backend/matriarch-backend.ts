import type {
  AgentSnapshot,
  CoordinatorState,
  Gate,
  InboxFilter,
  Message,
  ReviewStatus,
  Task,
  TaskDetail,
  TaskFilter,
  TerminalHandle,
  TerminalSummary
} from './matriarch-types'

/**
 * Connection lifecycle states surfaced to the shell's connection/freshness
 * indicator. Mirrors the underlying transport but is backend-agnostic.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'auth-failed'

/** Unsubscribe handle returned by every push subscription. */
export type Unsubscribe = () => void

/**
 * A live, push-or-poll data feed the UI subscribes to. The adapter decides
 * whether it is genuinely pushed (live) or interval-polled; `isLive` lets the UI
 * label freshness honestly (never present polled data as "live").
 */
export type LiveFeed<T> = {
  /** Whether updates arrive via real server push (true) or interval poll (false). */
  readonly isLive: boolean
  /** Poll cadence in ms when not live; undefined when live. */
  readonly pollIntervalMs?: number
  /**
   * Subscribe to snapshots. The callback fires with the full current value on
   * subscribe (if available) and on every subsequent change.
   */
  subscribe(listener: (value: FeedEvent<T>) => void): Unsubscribe
}

/** Each feed event carries data plus freshness metadata for honest UI states. */
export type FeedEvent<T> = {
  value: T
  /** ms epoch when this value was produced/received. */
  updatedAt: number
  /** Set when the latest fetch/subscribe attempt failed; last-known value still in `value`. */
  error?: { code: string; message: string }
}

/**
 * The single boundary between the portal UI and any backend (PRD §4.4 / NFR7).
 * Orca is the reference implementation; a mock implementation backs tests + the
 * design-data dev mode. No UI component may import a backend SDK directly —
 * everything goes through this interface.
 *
 * v1 (Epics 1–4) uses only the connection + read surface. The interact (R2),
 * review & ship (R3) methods are declared optional so adapters can grow into
 * them without breaking the v1 contract; v1 UI never calls them.
 */
export type MatriarchBackend = {
  // ── connection / auth ────────────────────────────────────────────────
  /** Human-readable name of the active backend (shown in the shell chip). */
  readonly name: string
  /** Current connection state. */
  readonly connectionState: ConnectionState
  /** Subscribe to connection-state changes; fires immediately with current state. */
  onConnectionChange(listener: (state: ConnectionState) => void): Unsubscribe
  /** Tear down all sockets/subscriptions. Idempotent. */
  disconnect(): void

  // ── read (v1) ────────────────────────────────────────────────────────
  /** Live per-agent feed. Orca: session.tabs.subscribeAll → agentStatus lift. */
  agents(): LiveFeed<AgentSnapshot[]>
  /** Live (poll-backed in v1) task feed for the Board. Orca: orchestration.taskList. */
  tasks(filter?: TaskFilter): LiveFeed<Task[]>
  /** One task's full detail (spec, history, dispatch, related gate/messages). */
  taskDetail(id: string): Promise<TaskDetail>
  /** Decision gates (pending + resolved). Orca: orchestration.gateList. */
  gates(): LiveFeed<Gate[]>
  /** Message/audit log. Orca: orchestration.inbox. */
  inbox(filter?: InboxFilter): LiveFeed<Message[]>
  /** Derived coordinator status. Orca: taskList + gateList + run guard. */
  coordinator(): LiveFeed<CoordinatorState>
  /** All terminals across worktrees (incl. plain shells), for the unified Board. Orca: terminal.list (poll). */
  terminals(): LiveFeed<TerminalSummary[]>
  /** Focus/reveal a terminal pane in the desktop Orca app. Orca: terminal.focus.
   *  A navigation action (no data mutation) — the portal's one jump back into Orca. */
  focusInOrca?(handle: string): Promise<void>
  /** Hand an orphaned/stale task to the coordinator ("matriarch") to pick up, get
   *  context, and likely close. Orca: orchestration.send to the coordinator handle.
   *  Rejects when no coordinator is running. Absent when the backend can't write. */
  handToCoordinator?(task: Task): Promise<void>

  // ── interact (R2 — declared, unused in v1) ───────────────────────────
  createTask?(spec: string, deps?: string[], parent?: string): Promise<Task>
  updateTask?(id: string, status: string, result?: string): Promise<Task>
  listTerminals?(): Promise<TerminalHandle[]>
  isAgentEligible?(handle: string): Promise<boolean>
  dispatch?(taskId: string, target: string, opts?: unknown): Promise<unknown>
  resolveGate?(id: string, resolution: string): Promise<Gate>
  reply?(messageId: string, body: string): Promise<Message>
  sendMessage?(to: string, body: string, opts?: unknown): Promise<void>
  runCoordinator?(spec: string, opts?: unknown): Promise<string>
  stopCoordinator?(): Promise<void>

  // ── review & ship (R3 — declared, needs a backend addition) ──────────
  // Why optional + unimplemented by the Orca adapter today: the runtime's
  // hostedReview surface is Electron-IPC only, not on the WebRuntimeClient RPC
  // the portal speaks. A remote review-status read is a scoped BACKEND ADDITION
  // (PRD risk R2). The provider-agnostic capability logic that shapes the UI is
  // already pure + tested (surfaces/review-model.ts), so wiring is low-risk once
  // the RPC lands. Capability presence is gated on this method existing (NFR9).
  reviewStatus?(branch: string): Promise<ReviewStatus>
}
