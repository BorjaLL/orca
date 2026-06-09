import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
import type { WebRuntimeClient } from '../../../web/web-runtime-client'
import type { AgentSnapshot, Task, TerminalSummary } from '../matriarch-types'
import { FeedSource } from '../live-feed'
import { collectCoordinatorHandles, mapAgentSnapshot, mapTerminalSummary } from './orca-mappers'
import type { OrcaTerminalListResult, OrcaTerminalSummary } from './orca-wire-types'

const TERMINAL_REFRESH_MS = 5000

type SubscribeFrame = {
  type?: 'snapshots' | 'updated' | 'end'
  snapshots?: SessionTabsSnapshot[]
} & Partial<SessionTabsSnapshot>

type SessionTabsSnapshot = {
  worktree: string
  tabs: SessionSnapshotTab[]
}

type SessionSnapshotTab = {
  type?: string
  agentStatus?: AgentStatusEntry | null
}

/**
 * Owns the live Agents feed for the Orca adapter: subscribes to
 * session.tabs.subscribeAll, joins paneKey→handle via terminal.list, and
 * republishes a mapped AgentSnapshot[] on every relevant change. Re-subscribes
 * with backoff on drop (WebRuntimeClient subscriptions don't auto-resume).
 * Extracted from the backend to keep each module focused.
 */
export class OrcaAgentFeed {
  readonly source = new FeedSource<AgentSnapshot[]>(true)
  // Surfaces ALL terminals (incl. plain shells) from the same terminal.list poll
  // the handle-join already runs — the unified Board's Parked column reads this.
  readonly terminalSource = new FeedSource<TerminalSummary[]>(false, TERMINAL_REFRESH_MS)

  private snapshotsByWorktree = new Map<string, SessionSnapshotTab[]>()
  private handleByPaneKey = new Map<string, OrcaTerminalSummary>()
  private taskTitleById = new Map<string, string>()
  private coordinatorHandle: string | null = null

  private subHandle: { unsubscribe: () => void } | null = null
  private terminalRefreshTimer: ReturnType<typeof setInterval> | null = null
  private resubscribeTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly client: WebRuntimeClient,
    private readonly now: () => number,
    private readonly call: <T>(method: string, params?: unknown) => Promise<T>
  ) {}

  start(): void {
    this.startSubscription()
    this.startTerminalRefresh()
  }

  /** Update the task-title map so agent labels track their dispatched task. */
  setTaskTitles(taskTitleById: Map<string, string>): void {
    this.taskTitleById = taskTitleById
    this.republish(this.now())
  }

  /** The current coordinator ("matriarch") handle, when one is known — the live
   *  coordinator agent's handle, else any handle children reference. */
  currentCoordinatorHandle(): string | null {
    return this.coordinatorHandle
  }

  stop(): void {
    this.disposed = true
    this.subHandle?.unsubscribe()
    this.subHandle = null
    if (this.terminalRefreshTimer) {
      clearInterval(this.terminalRefreshTimer)
    }
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer)
    }
  }

  private startSubscription(): void {
    if (this.disposed) {
      return
    }
    void this.client
      .subscribe(
        'session.tabs.subscribeAll',
        {},
        {
          onResponse: (response) => this.onFrame(response),
          onError: () => this.scheduleResubscribe(),
          onClose: () => this.scheduleResubscribe()
        }
      )
      .then((handle) => {
        if (this.disposed) {
          handle.unsubscribe()
          return
        }
        this.subHandle = handle
      })
      .catch(() => this.scheduleResubscribe())
  }

  private scheduleResubscribe(): void {
    if (this.disposed || this.resubscribeTimer) {
      return
    }
    this.subHandle = null
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = null
      this.startSubscription()
    }, 2000)
  }

  private onFrame(response: RuntimeRpcResponse<unknown>): void {
    if (!response.ok) {
      return
    }
    const frame = response.result as SubscribeFrame
    if (frame.type === 'snapshots' && frame.snapshots) {
      this.snapshotsByWorktree.clear()
      for (const snap of frame.snapshots) {
        this.snapshotsByWorktree.set(snap.worktree, snap.tabs ?? [])
      }
    } else if (frame.type === 'updated' && typeof frame.worktree === 'string') {
      this.snapshotsByWorktree.set(frame.worktree, frame.tabs ?? [])
    } else {
      return
    }
    this.republish(this.now())
  }

  private startTerminalRefresh(): void {
    const refresh = async (): Promise<void> => {
      if (this.disposed) {
        return
      }
      try {
        const result = await this.call<OrcaTerminalListResult>('terminal.list', {})
        const next = new Map<string, OrcaTerminalSummary>()
        for (const term of result.terminals ?? []) {
          next.set(`${term.tabId}:${term.leafId}`, term)
        }
        this.handleByPaneKey = next
        this.terminalSource.emit([...next.values()].map(mapTerminalSummary), this.now())
        this.republish(this.now())
      } catch (error) {
        // Keep the last-known handle map; agents still render via paneKey.
        const message = error instanceof Error ? error.message : String(error)
        this.terminalSource.emitError('terminal_list_failed', message, this.now())
      }
    }
    void refresh()
    this.terminalRefreshTimer = setInterval(() => void refresh(), TERMINAL_REFRESH_MS)
  }

  private republish(updatedAt: number): void {
    const entries: AgentStatusEntry[] = []
    for (const tabs of this.snapshotsByWorktree.values()) {
      for (const tab of tabs) {
        if (tab.agentStatus && tab.agentStatus.paneKey) {
          entries.push(tab.agentStatus)
        }
      }
    }
    const ctx = {
      handleByPaneKey: this.handleByPaneKey,
      coordinatorHandles: collectCoordinatorHandles(entries),
      taskTitleById: this.taskTitleById,
      now: this.now()
    }
    const agents = entries.map((entry) => mapAgentSnapshot(entry, ctx))
    // Prefer the live coordinator agent's handle; fall back to any handle the
    // children reference (the coordinator pane may have decayed out of the feed).
    this.coordinatorHandle =
      agents.find((a) => a.isCoordinator)?.handle ?? [...ctx.coordinatorHandles][0] ?? null
    this.source.emit(agents, updatedAt)
  }
}

export type { Task }
