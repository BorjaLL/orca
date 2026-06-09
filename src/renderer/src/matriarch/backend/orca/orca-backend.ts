import { WebRuntimeClient } from '../../../web/web-runtime-client'
import type { WebPairingOffer } from '../../../web/web-pairing'
import type { ConnectionState, LiveFeed, MatriarchBackend, Unsubscribe } from '../matriarch-backend'
import type {
  AgentSnapshot,
  CoordinatorState,
  Gate,
  InboxFilter,
  Message,
  Task,
  TaskDetail,
  TaskFilter,
  TerminalSummary
} from '../matriarch-types'
import { asLiveFeed, FeedSource } from '../live-feed'
import { OrcaPoller } from './orca-poller'
import { OrcaAgentFeed } from './orca-agent-feed'
import {
  deriveCoordinatorState,
  deriveTaskHistory,
  mapGate,
  mapMessage,
  mapTask
} from './orca-mappers'
import type {
  OrcaGateListResult,
  OrcaGateRow,
  OrcaInboxResult,
  OrcaTaskListResult
} from './orca-wire-types'

const DEFAULT_POLL_MS = 3000
const CONNECTION_PROBE_MS = 4000

/**
 * The Orca reference implementation of MatriarchBackend (PRD §4.4). Maps the
 * portal's read surface onto the real runtime RPC over the existing E2EE
 * WebSocket client — ZERO runtime changes:
 *  - agents()      → session.tabs.subscribeAll (live push) + terminal.list join (OrcaAgentFeed)
 *  - tasks()       → orchestration.taskList (interval poll)
 *  - gates()       → orchestration.gateList (interval poll)
 *  - inbox()       → orchestration.inbox (interval poll)
 *  - coordinator() → derived from tasks (no coordinator-status RPC exists)
 */
export class OrcaMatriarchBackend implements MatriarchBackend {
  readonly name: string
  connectionState: ConnectionState = 'connecting'

  private readonly client: WebRuntimeClient
  private readonly connectionListeners = new Set<(s: ConnectionState) => void>()
  private readonly now: () => number
  private connectionProbeTimer: ReturnType<typeof setInterval> | null = null

  private readonly agentFeed: OrcaAgentFeed
  private readonly tasksPoller: OrcaPoller<Task[]>
  private readonly gatesPoller: OrcaPoller<Gate[]>
  private readonly inboxPoller: OrcaPoller<Message[]>
  private readonly coordinatorSource = new FeedSource<CoordinatorState>(false, DEFAULT_POLL_MS)

  private disposed = false

  constructor(
    name: string,
    offer: WebPairingOffer,
    options: { pollIntervalMs?: number; now?: () => number } = {}
  ) {
    this.name = name
    this.now = options.now ?? (() => Date.now())
    this.client = new WebRuntimeClient(offer)
    const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS
    const call = <T>(method: string, params?: unknown): Promise<T> => this.call<T>(method, params)

    this.agentFeed = new OrcaAgentFeed(this.client, this.now, call)
    this.tasksPoller = new OrcaPoller<Task[]>(() => this.fetchTasks(), pollMs, this.now)
    this.gatesPoller = new OrcaPoller<Gate[]>(() => this.fetchGates(), pollMs, this.now)
    this.inboxPoller = new OrcaPoller<Message[]>(() => this.fetchInbox(), pollMs, this.now)

    // The coordinator summary + agent labels both depend on the task list —
    // recompute them whenever tasks change.
    this.tasksPoller.source.subscribe((event) => {
      const tasks = event.value ?? []
      this.coordinatorSource.emit(deriveCoordinatorState(tasks), event.updatedAt)
      this.agentFeed.setTaskTitles(new Map(tasks.map((t) => [t.id, t.title])))
    })

    this.beginConnectionTracking()
    this.agentFeed.start()
    this.tasksPoller.start()
    this.gatesPoller.start()
    this.inboxPoller.start()
  }

  onConnectionChange(listener: (state: ConnectionState) => void): Unsubscribe {
    this.connectionListeners.add(listener)
    listener(this.connectionState)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  disconnect(): void {
    this.disposed = true
    this.agentFeed.stop()
    if (this.connectionProbeTimer) {
      clearInterval(this.connectionProbeTimer)
    }
    this.tasksPoller.stop()
    this.gatesPoller.stop()
    this.inboxPoller.stop()
    this.client.close()
    this.setConnectionState('disconnected')
  }

  agents(): LiveFeed<AgentSnapshot[]> {
    return asLiveFeed(this.agentFeed.source)
  }

  terminals(): LiveFeed<TerminalSummary[]> {
    return asLiveFeed(this.agentFeed.terminalSource)
  }

  // Why: reveal the pane in the desktop app so "Open in Orca" lands the user on
  // the right terminal tab. terminal.focus is a UI-navigation call, not a write.
  async focusInOrca(handle: string): Promise<void> {
    await this.call('terminal.focus', { terminal: handle })
  }

  // Why: an orphaned/stale dispatch needs an owner. Hand it to the coordinator
  // ("matriarch") via a handoff message so its loop picks it up, gets context,
  // and resolves/closes it — the portal's one delegation write.
  async handToCoordinator(task: Task): Promise<void> {
    const coordinator = this.agentFeed.currentCoordinatorHandle()
    if (!coordinator) {
      throw new Error('No coordinator is running to hand this task to.')
    }
    await this.call('orchestration.send', {
      to: coordinator,
      subject: `Please pick up orphaned task ${task.id}`,
      body: `Task ${task.id} ("${task.title}") is still marked dispatched but no live pane is working it. Please get context and resolve or close it.`,
      type: 'handoff',
      priority: 'high'
    })
  }

  tasks(filter?: TaskFilter): LiveFeed<Task[]> {
    if (!filter?.status) {
      return asLiveFeed(this.tasksPoller.source)
    }
    const derived = new FeedSource<Task[]>(false, DEFAULT_POLL_MS)
    this.tasksPoller.source.subscribe((event) => {
      derived.emit(
        (event.value ?? []).filter((t) => t.status === filter.status),
        event.updatedAt
      )
    })
    return asLiveFeed(derived)
  }

  async taskDetail(id: string): Promise<TaskDetail> {
    // No per-task GET RPC — read the list + gates + inbox and assemble detail
    // client-side (investigation Workstream B).
    const [tasks, gates, messages] = await Promise.all([
      this.fetchTasks(),
      this.fetchGates(),
      this.fetchInbox()
    ])
    const task = tasks.find((t) => t.id === id)
    if (!task) {
      throw new Error(`Task not found: ${id}`)
    }
    const gate = gates.find((g) => g.taskId === id && g.status === 'pending')
    const relatedMessages = messages.filter(
      (m) => m.fromHandle === task.assigneeHandle || m.toHandle === task.assigneeHandle
    )
    return { ...task, history: deriveTaskHistory(task), gate, relatedMessages }
  }

  gates(): LiveFeed<Gate[]> {
    return asLiveFeed(this.gatesPoller.source)
  }

  inbox(filter?: InboxFilter): LiveFeed<Message[]> {
    if (!filter?.handle && !filter?.type) {
      return asLiveFeed(this.inboxPoller.source)
    }
    const derived = new FeedSource<Message[]>(false, DEFAULT_POLL_MS)
    this.inboxPoller.source.subscribe((event) => {
      const filtered = (event.value ?? []).filter((m) => {
        const matchHandle =
          !filter.handle || m.fromHandle === filter.handle || m.toHandle === filter.handle
        const matchType = !filter.type || m.type === filter.type
        return matchHandle && matchType
      })
      derived.emit(filtered, event.updatedAt)
    })
    return asLiveFeed(derived)
  }

  coordinator(): LiveFeed<CoordinatorState> {
    return asLiveFeed(this.coordinatorSource)
  }

  // ── interact (R2) ────────────────────────────────────────────────────
  // Why: answering a decision gate is the highest-value, lowest-risk write the
  // existing runtime already supports (orchestration.gateResolve — no backend
  // change). The portal validates the resolution before this call (gate-model)
  // and confirms it as an explicit user action (NFR10). On success we kick the
  // gates poll so the rail/Sheet reflect the resolved row without waiting a tick.
  async resolveGate(id: string, resolution: string): Promise<Gate> {
    const result = await this.call<{ gate: OrcaGateRow }>('orchestration.gateResolve', {
      id,
      resolution
    })
    this.gatesPoller.refresh()
    return mapGate(result.gate)
  }

  // Why: send a message / nudge to a handle (PRD FR26) over the same
  // orchestration.send the coordinator handoff already uses. Refreshes the inbox
  // so the sent message appears in the audit trail.
  async sendMessage(
    to: string,
    body: string,
    opts?: { subject?: string; type?: string; priority?: string }
  ): Promise<void> {
    await this.call('orchestration.send', {
      to,
      subject: opts?.subject ?? 'Message from the portal',
      body,
      type: opts?.type ?? 'status',
      priority: opts?.priority ?? 'normal'
    })
    this.inboxPoller.refresh()
  }

  private beginConnectionTracking(): void {
    // WebRuntimeClient exposes no public state; infer connectedness from a
    // lightweight status probe so the indicator stays honest.
    const probe = async (): Promise<void> => {
      if (this.disposed) {
        return
      }
      try {
        await this.client.call('status.get', undefined, { timeoutMs: 8000 })
        this.setConnectionState('connected')
      } catch {
        this.setConnectionState(
          this.connectionState === 'connected' ? 'reconnecting' : 'connecting'
        )
      }
    }
    void probe()
    this.connectionProbeTimer = setInterval(() => void probe(), CONNECTION_PROBE_MS)
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) {
      return
    }
    this.connectionState = state
    for (const listener of this.connectionListeners) {
      listener(state)
    }
  }

  private async fetchTasks(): Promise<Task[]> {
    const result = await this.call<OrcaTaskListResult>('orchestration.taskList', {})
    return (result.tasks ?? []).map(mapTask)
  }

  private async fetchGates(): Promise<Gate[]> {
    const result = await this.call<OrcaGateListResult>('orchestration.gateList', {})
    return (result.gates ?? []).map(mapGate)
  }

  private async fetchInbox(): Promise<Message[]> {
    const result = await this.call<OrcaInboxResult>('orchestration.inbox', {})
    return (result.messages ?? []).map(mapMessage)
  }

  private async call<T>(method: string, params?: unknown): Promise<T> {
    const response = await this.client.call(method, params, { timeoutMs: 15_000 })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result as T
  }
}
