import { afterEach, describe, expect, it } from 'vitest'
import { MockMatriarchBackend } from './mock-backend'
import type { FeedEvent } from '../matriarch-backend'

function firstValue<T>(feed: {
  subscribe: (l: (e: FeedEvent<T>) => void) => () => void
}): T | null {
  let captured: T | null = null
  const unsub = feed.subscribe((event) => {
    captured = event.value
  })
  unsub()
  return captured
}

describe('MockMatriarchBackend', () => {
  let backend: MockMatriarchBackend

  afterEach(() => {
    backend?.disconnect()
  })

  it('reports connected and exposes a friendly name', () => {
    backend = new MockMatriarchBackend()
    expect(backend.connectionState).toBe('connected')
    expect(backend.name).toContain('run_7a3')
  })

  it('emits the run_7a3 agent fleet on the agents feed (live)', () => {
    backend = new MockMatriarchBackend()
    const feed = backend.agents()
    expect(feed.isLive).toBe(true)
    const agents = firstValue(feed)
    expect(agents).not.toBeNull()
    expect(agents!.length).toBe(7)
    expect(agents!.some((a) => a.isCoordinator)).toBe(true)
  })

  it('emits tasks as a polled feed with honest freshness metadata', () => {
    backend = new MockMatriarchBackend()
    const feed = backend.tasks()
    expect(feed.isLive).toBe(false)
    expect(feed.pollIntervalMs).toBe(2000)
    const tasks = firstValue(feed)
    expect(tasks!.length).toBe(14)
  })

  it('filters tasks by status', () => {
    backend = new MockMatriarchBackend()
    const dispatched = firstValue(backend.tasks({ status: 'dispatched' }))
    expect(dispatched!.every((t) => t.status === 'dispatched')).toBe(true)
    // task_cc06, task_cc07 (live) + task_or15 (orphaned dispatch fixture).
    expect(dispatched!.length).toBe(3)
  })

  it('assembles task detail with related gate + messages', async () => {
    backend = new MockMatriarchBackend()
    const detail = await backend.taskDetail('task_ff14')
    expect(detail.gate?.id).toBe('gate_01')
    expect(detail.history.length).toBeGreaterThan(0)
  })

  it('exposes gates on the gates feed (not tasks)', () => {
    backend = new MockMatriarchBackend()
    const gates = firstValue(backend.gates())
    expect(gates).not.toBeNull()
    // Every item must be a Gate (has a question + options), guarding the
    // feed-source-wiring regression where tasks leaked into the gates feed.
    expect(gates!.every((g) => typeof g.question === 'string' && Array.isArray(g.options))).toBe(
      true
    )
    expect(gates!.some((g) => g.id === 'gate_01' && g.status === 'pending')).toBe(true)
  })

  it('emits all terminals (agent-backed + plain shells) as a polled feed', () => {
    backend = new MockMatriarchBackend()
    const feed = backend.terminals()
    expect(feed.isLive).toBe(false)
    expect(feed.pollIntervalMs).toBe(2000)
    const terminals = firstValue(feed)
    expect(terminals).not.toBeNull()
    expect(terminals!.length).toBe(8)
    // A genuine plain shell (no agent, no task) must be present for Parked.
    expect(terminals!.some((t) => t.handle === 'term_ssh')).toBe(true)
  })

  it('rebases agent timestamps to real time when no clock is injected', () => {
    const realBackend = new MockMatriarchBackend()
    const agents = firstValue(realBackend.agents())
    // Freshest agent should be within a minute of now (anchored to real time),
    // not stuck at the frozen MOCK_NOW — this is what makes #mock read "Live".
    const newest = Math.max(...agents!.map((a) => a.updatedAt))
    expect(Date.now() - newest).toBeLessThan(60_000)
    realBackend.disconnect()
  })

  it('keeps fixtures verbatim (offset 0) when a clock is injected', () => {
    const fixed = new MockMatriarchBackend({ now: () => Date.parse('2026-05-30T10:35:00Z') })
    const agents = firstValue(fixed.agents())
    const coord = agents!.find((a) => a.isCoordinator)
    expect(coord?.updatedAt).toBe(Date.parse('2026-05-30T10:35:00Z'))
    fixed.disconnect()
  })

  it('derives a running coordinator with status counts', () => {
    backend = new MockMatriarchBackend()
    const state = firstValue(backend.coordinator())
    expect(state!.status).toBe('running')
    expect(state!.activeDispatches).toBe(3)
    expect(state!.counts.completed).toBe(4)
  })

  it('filters the inbox by recipient and type', () => {
    backend = new MockMatriarchBackend()
    const escalations = firstValue(backend.inbox({ type: 'escalation' }))
    expect(escalations!.every((m) => m.type === 'escalation')).toBe(true)
    const forCoord = firstValue(backend.inbox({ handle: 'term_coord' }))
    expect(
      forCoord!.every((m) => m.toHandle === 'term_coord' || m.fromHandle === 'term_coord')
    ).toBe(true)
  })

  it('exposes the R2 interact methods (resolveGate + sendMessage)', () => {
    backend = new MockMatriarchBackend({ now: () => 1_700_000_000_000 })
    expect(typeof backend.resolveGate).toBe('function')
    expect(typeof backend.sendMessage).toBe('function')
  })

  it('resolveGate flips the gate to resolved and re-emits the gates feed', async () => {
    backend = new MockMatriarchBackend({ now: () => 1_700_000_000_000 })
    const resolved = await backend.resolveGate('gate_01', 'Use Zustand')
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolution).toBe('Use Zustand')
    expect(resolved.resolvedAt).toBe(new Date(1_700_000_000_000).toISOString())
    // The live gates feed reflects the change (so the rail/Sheet update).
    const gates = firstValue(backend.gates())
    expect(gates!.find((g) => g.id === 'gate_01')?.status).toBe('resolved')
  })

  it('resolveGate rejects an unknown gate id', async () => {
    backend = new MockMatriarchBackend({ now: () => 1_700_000_000_000 })
    await expect(backend.resolveGate('nope', 'x')).rejects.toThrow(/not found/i)
  })

  it('sendMessage appends to the inbox audit trail', async () => {
    backend = new MockMatriarchBackend({ now: () => 1_700_000_000_000 })
    const before = firstValue(backend.inbox())!.length
    await backend.sendMessage('term_w', 'pick up task_or15', { type: 'handoff', priority: 'high' })
    const after = firstValue(backend.inbox())!
    expect(after.length).toBe(before + 1)
    const sent = after.at(-1)!
    expect(sent.toHandle).toBe('term_w')
    expect(sent.type).toBe('handoff')
    expect(sent.body).toBe('pick up task_or15')
  })
})
