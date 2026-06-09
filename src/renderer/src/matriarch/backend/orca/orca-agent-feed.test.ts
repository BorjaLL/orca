/* oxlint-disable max-lines -- Why: the OrcaAgentFeed lifecycle cases (frame handling,
   handle join, coordinator pick, terminal poll, resubscribe backoff) all share one
   FakeRuntimeClient + helpers; splitting would scatter closely-related assertions. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
import type { WebRuntimeClient } from '../../../web/web-runtime-client'
import type { AgentSnapshot, TerminalSummary } from '../matriarch-types'
import type { FeedEvent } from '../matriarch-backend'
import { OrcaAgentFeed } from './orca-agent-feed'
import type { OrcaTerminalListResult, OrcaTerminalSummary } from './orca-wire-types'

// OrcaAgentFeed owns the live Agents feed: it subscribes to
// session.tabs.subscribeAll, joins paneKey->handle via a terminal.list poll, and
// republishes a mapped AgentSnapshot[] on every relevant change, re-subscribing
// with backoff on drop. These tests drive it with a FAKE WebRuntimeClient so the
// frame handling, the handle join, the coordinator-handle pick, and the
// resubscribe lifecycle get direct coverage (not just via the pure mappers).

type SubscribeCallbacks = {
  onResponse: (response: RuntimeRpcResponse<unknown>) => void
  onError?: (error: { code: string; message: string }) => void
  onClose?: () => void
}

/**
 * Minimal stand-in for the parts of WebRuntimeClient that OrcaAgentFeed uses:
 * a single `subscribe` channel (session.tabs.subscribeAll). Captures the live
 * callbacks so a test can push frames, and records subscribe/unsubscribe calls
 * so resubscribe-on-drop is observable. `subscribe` resolves on the next
 * microtask (mirrors the real async handshake).
 */
class FakeRuntimeClient {
  subscribeCalls = 0
  unsubscribeCalls = 0
  lastCallbacks: SubscribeCallbacks | null = null
  /** When set, the next subscribe() rejects (handshake failure path). */
  failNextSubscribe = false

  subscribe(
    _method: string,
    _params: unknown,
    callbacks: SubscribeCallbacks
  ): Promise<{ unsubscribe: () => void }> {
    this.subscribeCalls += 1
    if (this.failNextSubscribe) {
      this.failNextSubscribe = false
      return Promise.reject(new Error('handshake failed'))
    }
    this.lastCallbacks = callbacks
    return Promise.resolve({
      unsubscribe: () => {
        this.unsubscribeCalls += 1
      }
    })
  }

  /** Push a server frame to the live subscription. */
  pushFrame(result: unknown): void {
    this.lastCallbacks?.onResponse({
      id: '1',
      ok: true,
      result,
      _meta: { runtimeId: 'test' }
    })
  }

  /** Trigger the subscription error path (drives resubscribe scheduling). */
  pushError(): void {
    this.lastCallbacks?.onError?.({ code: 'closed', message: 'socket closed' })
  }

  asClient(): WebRuntimeClient {
    return this as unknown as WebRuntimeClient
  }
}

const NOW = 1_700_000_000_000

function entry(o: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'do the thing',
    updatedAt: NOW,
    stateStartedAt: NOW,
    paneKey: 'tab1:leaf1',
    stateHistory: [],
    ...o
  }
}

function term(o: Partial<OrcaTerminalSummary> = {}): OrcaTerminalSummary {
  return {
    handle: 'term_a',
    worktreeId: 'wt::/Users/me/orca/workspaces/orca/portal',
    worktreePath: '/Users/me/orca/workspaces/orca/portal',
    branch: 'refs/heads/main',
    tabId: 'tab1',
    leafId: 'leaf1',
    title: null,
    connected: true,
    writable: true,
    lastOutputAt: NOW,
    preview: '',
    note: '',
    ...o
  }
}

function snapshotsFrame(tabs: { agentStatus?: AgentStatusEntry | null }[]): unknown {
  return { type: 'snapshots', snapshots: [{ worktree: 'wt', tabs }] }
}

/** Build a feed wired to a fake client + a terminal.list responder we control. */
function makeFeed(
  client: FakeRuntimeClient,
  terminals: OrcaTerminalSummary[]
): {
  feed: OrcaAgentFeed
  agentEvents: FeedEvent<AgentSnapshot[]>[]
  terminalEvents: FeedEvent<TerminalSummary[]>[]
} {
  const call = <T>(method: string): Promise<T> => {
    if (method === 'terminal.list') {
      const result: OrcaTerminalListResult = {
        terminals,
        totalCount: terminals.length,
        truncated: false
      }
      return Promise.resolve(result as unknown as T)
    }
    return Promise.reject(new Error(`unexpected call ${method}`))
  }
  const feed = new OrcaAgentFeed(client.asClient(), () => NOW, call)
  const agentEvents: FeedEvent<AgentSnapshot[]>[] = []
  const terminalEvents: FeedEvent<TerminalSummary[]>[] = []
  feed.source.subscribe((e) => agentEvents.push(e))
  feed.terminalSource.subscribe((e) => terminalEvents.push(e))
  return { feed, agentEvents, terminalEvents }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OrcaAgentFeed — feed shape', () => {
  it('exposes a live agent source and a polled terminal source', () => {
    const { feed } = makeFeed(new FakeRuntimeClient(), [])
    expect(feed.source.isLive).toBe(true)
    expect(feed.terminalSource.isLive).toBe(false)
    expect(feed.terminalSource.pollIntervalMs).toBe(5000)
    feed.stop()
  })
})

describe('OrcaAgentFeed — subscription frames -> AgentSnapshot[]', () => {
  it('republishes mapped agents from a snapshots frame, joined to the handle map', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0) // resolve subscribe() + the immediate terminal.list

    client.pushFrame(snapshotsFrame([{ agentStatus: entry() }]))

    const last = agentEvents.at(-1)
    expect(last?.value).toHaveLength(1)
    const agent = last?.value[0] as AgentSnapshot
    // paneKey -> handle resolved via terminal.list, worktree name derived.
    expect(agent.handle).toBe('term_a')
    expect(agent.paneKey).toBe('tab1:leaf1')
    expect(agent.state).toBe('working')
    expect(agent.worktreeName).toBe('portal')
    feed.stop()
  })

  it('falls back to the paneKey as handle when terminal.list has no match', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, []) // empty terminal list
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    client.pushFrame(snapshotsFrame([{ agentStatus: entry({ paneKey: 'tabX:leafX' }) }]))

    expect(agentEvents.at(-1)?.value[0]?.handle).toBe('tabX:leafX')
    feed.stop()
  })

  it('skips tabs with no agentStatus', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    client.pushFrame(snapshotsFrame([{ agentStatus: null }, { agentStatus: entry() }, {}]))

    expect(agentEvents.at(-1)?.value).toHaveLength(1)
    feed.stop()
  })

  it('an "updated" frame replaces only that worktree, keeping others', async () => {
    const client = new FakeRuntimeClient()
    const terms = [
      term({ handle: 'term_a', tabId: 'tab1', leafId: 'leaf1' }),
      term({ handle: 'term_b', tabId: 'tab2', leafId: 'leaf2' })
    ]
    const { feed, agentEvents } = makeFeed(client, terms)
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    // Seed two worktrees via a snapshots frame.
    client.pushFrame({
      type: 'snapshots',
      snapshots: [
        { worktree: 'wtA', tabs: [{ agentStatus: entry({ paneKey: 'tab1:leaf1' }) }] },
        { worktree: 'wtB', tabs: [{ agentStatus: entry({ paneKey: 'tab2:leaf2' }) }] }
      ]
    })
    expect(agentEvents.at(-1)?.value).toHaveLength(2)

    // Update only wtB to empty; wtA's agent must remain.
    client.pushFrame({ type: 'updated', worktree: 'wtB', tabs: [] })
    const handles = (agentEvents.at(-1)?.value ?? []).map((a) => a.handle)
    expect(handles).toEqual(['term_a'])
    feed.stop()
  })

  it('ignores unknown frame types (no republish)', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    const before = agentEvents.length

    client.pushFrame({ type: 'end' })
    expect(agentEvents.length).toBe(before)
    feed.stop()
  })

  it('ignores a non-ok response frame', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    const before = agentEvents.length

    client.lastCallbacks?.onResponse({
      id: '1',
      ok: false,
      error: { code: 'boom', message: 'nope' },
      _meta: { runtimeId: 'test' }
    })
    expect(agentEvents.length).toBe(before)
    feed.stop()
  })
})

describe('OrcaAgentFeed — terminal source', () => {
  it('emits mapped TerminalSummary[] from the terminal.list poll', async () => {
    const client = new FakeRuntimeClient()
    const { feed, terminalEvents } = makeFeed(client, [term({ note: ' wiring ports ' })])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    const last = terminalEvents.at(-1)
    expect(last?.value).toHaveLength(1)
    expect(last?.value[0]?.handle).toBe('term_a')
    expect(last?.value[0]?.branch).toBe('main') // refs/heads/ stripped
    expect(last?.value[0]?.note).toBe('wiring ports') // trimmed
    feed.stop()
  })

  it('emits an error on the terminal source when terminal.list rejects, keeping agents alive', async () => {
    const client = new FakeRuntimeClient()
    const call = <T>(): Promise<T> => Promise.reject(new Error('list down'))
    const feed = new OrcaAgentFeed(client.asClient(), () => NOW, call)
    const terminalEvents: FeedEvent<TerminalSummary[]>[] = []
    feed.terminalSource.subscribe((e) => terminalEvents.push(e))
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(terminalEvents.at(-1)?.error?.code).toBe('terminal_list_failed')
    // Agents still map (via paneKey) even with no handle map.
    client.pushFrame(snapshotsFrame([{ agentStatus: entry({ paneKey: 'p:q' }) }]))
    feed.stop()
  })
})

describe('OrcaAgentFeed — coordinator handle', () => {
  it('picks the live coordinator agent handle when one is in the feed', async () => {
    const client = new FakeRuntimeClient()
    const terms = [
      term({ handle: 'term_coord', tabId: 'c', leafId: 'c' }),
      term({ handle: 'term_w', tabId: 'w', leafId: 'w' })
    ]
    const { feed } = makeFeed(client, terms)
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    client.pushFrame(
      snapshotsFrame([
        // Worker references term_coord as its coordinator -> term_coord is a coordinator handle.
        {
          agentStatus: entry({
            paneKey: 'w:w',
            orchestration: {
              taskId: 't1',
              dispatchId: 'd1',
              coordinatorHandle: 'term_coord'
            }
          })
        },
        { agentStatus: entry({ paneKey: 'c:c', prompt: 'orchestrate' }) }
      ])
    )

    expect(feed.currentCoordinatorHandle()).toBe('term_coord')
    feed.stop()
  })

  it('falls back to a referenced coordinator handle when the coordinator pane is absent', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term({ handle: 'term_w', tabId: 'w', leafId: 'w' })])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    client.pushFrame(
      snapshotsFrame([
        {
          agentStatus: entry({
            paneKey: 'w:w',
            orchestration: { taskId: 't1', dispatchId: 'd1', coordinatorHandle: 'term_ghost' }
          })
        }
      ])
    )
    expect(feed.currentCoordinatorHandle()).toBe('term_ghost')
    feed.stop()
  })

  it('is null when no coordinator is referenced', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    client.pushFrame(snapshotsFrame([{ agentStatus: entry() }]))
    expect(feed.currentCoordinatorHandle()).toBeNull()
    feed.stop()
  })
})

describe('OrcaAgentFeed — task titles', () => {
  it('labels a dispatched agent with its task title once setTaskTitles runs', async () => {
    const client = new FakeRuntimeClient()
    const { feed, agentEvents } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    client.pushFrame(
      snapshotsFrame([
        {
          agentStatus: entry({
            orchestration: { taskId: 'task_9', dispatchId: 'd' }
          })
        }
      ])
    )
    // Before titles are known, the label derives from the prompt.
    expect(agentEvents.at(-1)?.value[0]?.label).toBe('do the thing')

    feed.setTaskTitles(new Map([['task_9', 'Wire the ports']]))
    expect(agentEvents.at(-1)?.value[0]?.label).toBe('Wire the ports')
    feed.stop()
  })
})

describe('OrcaAgentFeed — resubscribe lifecycle', () => {
  it('re-subscribes after an error, with a backoff delay', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.subscribeCalls).toBe(1)

    client.pushError()
    // Backoff is 2s; nothing before it.
    await vi.advanceTimersByTimeAsync(1999)
    expect(client.subscribeCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.subscribeCalls).toBe(2)
    feed.stop()
  })

  it('coalesces multiple drops into a single pending resubscribe', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)

    client.pushError()
    client.pushError() // second drop while a resubscribe is already scheduled
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.subscribeCalls).toBe(2) // one resubscribe, not two
    feed.stop()
  })

  it('schedules a resubscribe when the initial handshake rejects', async () => {
    const client = new FakeRuntimeClient()
    client.failNextSubscribe = true
    const { feed } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0) // the failed subscribe rejects
    expect(client.subscribeCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.subscribeCalls).toBe(2)
    feed.stop()
  })

  it('stop() unsubscribes and halts the terminal poll + any resubscribe', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term()])
    feed.start()
    await vi.advanceTimersByTimeAsync(0)
    feed.stop()
    expect(client.unsubscribeCalls).toBe(1)

    // No further terminal.list polls or resubscribes after stop.
    const subsAtStop = client.subscribeCalls
    client.pushError()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(client.subscribeCalls).toBe(subsAtStop)
  })

  it('unsubscribes immediately if the handshake resolves after stop', async () => {
    const client = new FakeRuntimeClient()
    const { feed } = makeFeed(client, [term()])
    feed.start()
    feed.stop() // stop before the subscribe() promise resolves
    await vi.advanceTimersByTimeAsync(0)
    // The late-resolving handle is torn down rather than retained.
    expect(client.unsubscribeCalls).toBe(1)
  })
})
