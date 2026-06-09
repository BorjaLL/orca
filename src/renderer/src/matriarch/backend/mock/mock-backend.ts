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
import {
  deriveMockCoordinator,
  MOCK_AGENTS,
  MOCK_GATES,
  MOCK_MESSAGES,
  MOCK_NOW,
  MOCK_TASKS,
  MOCK_TERMINALS
} from './mock-fixtures'

export type MockBackendOptions = {
  /** Simulated network latency for promise-returning reads (ms). */
  latencyMs?: number
  /** When true, agents() re-emits periodically so the Live dot/feed feels real. */
  animate?: boolean
  /** Override the wall clock (tests pass a fixed value for determinism). */
  now?: () => number
}

/**
 * In-memory MatriarchBackend over the run_7a3 fixtures. Backs unit tests and the
 * design-data dev mode (no pairing required). Mirrors the real adapter's feed
 * semantics: agents() is "live", the rest are poll-backed, so the UI's freshness
 * labels behave identically to a paired runtime.
 */
export class MockMatriarchBackend implements MatriarchBackend {
  readonly name = 'Mock · run_7a3'
  connectionState: ConnectionState = 'connected'

  private readonly now: () => number
  private readonly latencyMs: number
  private readonly connectionListeners = new Set<(s: ConnectionState) => void>()

  private readonly agentsSource = new FeedSource<AgentSnapshot[]>(true)
  private readonly tasksSource = new FeedSource<Task[]>(false, 2000)
  private readonly gatesSource = new FeedSource<Gate[]>(false, 2000)
  private readonly inboxSource = new FeedSource<Message[]>(false, 2000)
  private readonly coordinatorSource = new FeedSource<CoordinatorState>(false, 2000)
  private readonly terminalsSource = new FeedSource<TerminalSummary[]>(false, 2000)

  // Why: NOT named `agents` — that's the read method below; a same-named field
  // would shadow it. Holds the (possibly clock-rebased) fixture fleet.
  private readonly agentFleet: AgentSnapshot[]
  private animateTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: MockBackendOptions = {}) {
    // Why: with no injected clock (the #mock dev surface), anchor the fixtures to
    // real time so the Agents feed reads fresh ("Live") and relative ages
    // ("3m ago") stay correct. Tests inject `now` and get the fixtures verbatim
    // (offset 0) for determinism.
    this.now = options.now ?? (() => Date.now())
    this.latencyMs = options.latencyMs ?? 0
    const offset = options.now ? 0 : this.now() - MOCK_NOW
    this.agentFleet = rebaseAgents(structuredCloneSafe(MOCK_AGENTS), offset)

    const at = this.now()
    this.agentsSource.emit(this.agentFleet, at)
    this.tasksSource.emit(structuredCloneSafe(MOCK_TASKS), at)
    this.gatesSource.emit(structuredCloneSafe(MOCK_GATES), at)
    this.inboxSource.emit(structuredCloneSafe(MOCK_MESSAGES), at)
    this.coordinatorSource.emit(deriveMockCoordinator(MOCK_TASKS), at)
    this.terminalsSource.emit(rebaseTerminals(structuredCloneSafe(MOCK_TERMINALS), offset), at)

    if (options.animate) {
      // Re-emit the agents feed periodically so the "Live · Ns" indicator ticks
      // and the dev surface looks alive. No state churn — just freshness.
      this.animateTimer = setInterval(() => {
        this.agentsSource.emit(this.agentFleet, Date.now())
      }, 3000)
    }
  }

  onConnectionChange(listener: (state: ConnectionState) => void): Unsubscribe {
    this.connectionListeners.add(listener)
    listener(this.connectionState)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  disconnect(): void {
    if (this.animateTimer) {
      clearInterval(this.animateTimer)
      this.animateTimer = null
    }
    this.setConnectionState('disconnected')
  }

  agents(): LiveFeed<AgentSnapshot[]> {
    return asLiveFeed(this.agentsSource)
  }

  tasks(filter?: TaskFilter): LiveFeed<Task[]> {
    if (!filter?.status && !filter?.runId) {
      return asLiveFeed(this.tasksSource)
    }
    // Filtered feeds are derived views over the same source.
    const derived = new FeedSource<Task[]>(false, 2000)
    this.tasksSource.subscribe((event) => {
      const filtered = event.value.filter((t) => !filter.status || t.status === filter.status)
      derived.emit(filtered, event.updatedAt)
    })
    return asLiveFeed(derived)
  }

  async taskDetail(id: string): Promise<TaskDetail> {
    await this.delay()
    const task = MOCK_TASKS.find((t) => t.id === id)
    if (!task) {
      throw new Error(`Task not found: ${id}`)
    }
    const gate = MOCK_GATES.find((g) => g.taskId === id && g.status === 'pending')
    const relatedMessages = MOCK_MESSAGES.filter(
      (m) => m.fromHandle === task.assigneeHandle || m.toHandle === task.assigneeHandle
    )
    return { ...task, history: deriveHistory(task), gate, relatedMessages }
  }

  gates(): LiveFeed<Gate[]> {
    return asLiveFeed(this.gatesSource)
  }

  inbox(filter?: InboxFilter): LiveFeed<Message[]> {
    if (!filter?.handle && !filter?.type) {
      return asLiveFeed(this.inboxSource)
    }
    const derived = new FeedSource<Message[]>(false, 2000)
    this.inboxSource.subscribe((event) => {
      const filtered = event.value.filter((m) => {
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

  terminals(): LiveFeed<TerminalSummary[]> {
    return asLiveFeed(this.terminalsSource)
  }

  // No desktop app behind the mock — "Open in Orca" is a no-op here.
  async focusInOrca(): Promise<void> {}

  // No live coordinator behind the mock — handing off is a no-op here.
  async handToCoordinator(): Promise<void> {}

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state
    for (const listener of this.connectionListeners) {
      listener(state)
    }
  }

  private delay(): Promise<void> {
    return this.latencyMs > 0
      ? new Promise((r) => setTimeout(r, this.latencyMs))
      : Promise.resolve()
  }
}

/** Shift each agent's timestamps by `offset` ms so fixtures anchor to real time. */
function rebaseAgents(agents: AgentSnapshot[], offset: number): AgentSnapshot[] {
  if (offset === 0) {
    return agents
  }
  return agents.map((agent) => ({
    ...agent,
    stateStartedAt: agent.stateStartedAt + offset,
    updatedAt: agent.updatedAt + offset
  }))
}

/** Shift each terminal's lastOutputAt by `offset` ms so fixtures anchor to real time. */
function rebaseTerminals(terminals: TerminalSummary[], offset: number): TerminalSummary[] {
  if (offset === 0) {
    return terminals
  }
  return terminals.map((t) => ({
    ...t,
    lastOutputAt: t.lastOutputAt === null ? null : t.lastOutputAt + offset
  }))
}

/** Derive a plausible status timeline for the detail Sheet from a task's terminal state. */
function deriveHistory(task: Task): TaskDetail['history'] {
  const history: TaskDetail['history'] = [{ status: 'ready', label: 'ready', time: '' }]
  if (task.assigneeHandle) {
    history.push({
      status: 'dispatched-to',
      label: `dispatched → ${task.assigneeHandle}`,
      time: task.startedAt ?? ''
    })
  }
  if (task.status === 'completed') {
    history.push({ status: 'completed', label: 'completed', time: task.completedAt ?? '' })
  } else if (task.status === 'failed') {
    history.push({
      status: 'failed',
      label: `failed · ${task.attempts ?? '3/3'}`,
      time: task.completedAt ?? ''
    })
  } else if (task.status === 'blocked') {
    history.push({ status: 'blocked', label: 'blocked on gate', time: '' })
  }
  return history
}

/** Deep clone without depending on structuredClone availability in all targets. */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
