import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaPoller } from './orca-poller'
import type { FeedEvent } from '../matriarch-backend'

// OrcaPoller is the honest "near-live" mechanism for the feeds with no server
// stream (tasks/gates/inbox). These tests drive it with fake timers + a fixed
// clock so the emit cadence, error handling, and lifecycle are deterministic.

let clock = 0
const now = (): number => clock

function collect<T>(poller: OrcaPoller<T>): FeedEvent<T>[] {
  const events: FeedEvent<T>[] = []
  poller.source.subscribe((event) => events.push(event))
  return events
}

beforeEach(() => {
  vi.useFakeTimers()
  clock = 1000
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OrcaPoller', () => {
  it('exposes a polled (not live) FeedSource carrying the interval', () => {
    const poller = new OrcaPoller(async () => 1, 2000, now)
    expect(poller.source.isLive).toBe(false)
    expect(poller.source.pollIntervalMs).toBe(2000)
  })

  it('fetches immediately on start, then once per interval', async () => {
    let n = 0
    const poller = new OrcaPoller(async () => ++n, 2000, now)
    const events = collect(poller)
    poller.start()
    await vi.advanceTimersByTimeAsync(0) // flush the immediate tick
    expect(events.at(-1)?.value).toBe(1)
    clock = 3000
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.at(-1)).toEqual({ value: 2, updatedAt: 3000 })
    clock = 5000
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.at(-1)).toEqual({ value: 3, updatedAt: 5000 })
    poller.stop()
  })

  it('keeps the last-known value and flags an error when a fetch rejects', async () => {
    let n = 0
    const poller = new OrcaPoller<number>(
      async () => {
        n += 1
        if (n === 2) {
          throw new Error('network down')
        }
        return n
      },
      2000,
      now
    )
    const events = collect(poller)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.at(-1)?.value).toBe(1)
    await vi.advanceTimersByTimeAsync(2000) // 2nd tick rejects
    const last = events.at(-1)
    expect(last?.value).toBe(1) // last-known value preserved
    expect(last?.error).toEqual({ code: 'poll_failed', message: 'network down' })
    poller.stop()
  })

  it('does not start a second overlapping fetch while one is in flight', async () => {
    let calls = 0
    const releasers: ((value: number) => void)[] = []
    const poller = new OrcaPoller<number>(
      () => {
        calls += 1
        return new Promise<number>((resolve) => {
          releasers.push(resolve)
        })
      },
      1000,
      now
    )
    poller.start() // tick 1 begins, never resolves yet
    await vi.advanceTimersByTimeAsync(1000) // interval fires while in flight
    await vi.advanceTimersByTimeAsync(1000) // and again
    expect(calls).toBe(1) // the inFlight guard suppressed the overlaps
    for (const resolve of releasers) {
      resolve(calls)
    }
    poller.stop()
  })

  it('start is idempotent (a second start does not double the cadence)', async () => {
    let calls = 0
    const poller = new OrcaPoller<number>(
      async () => {
        calls += 1
        return calls
      },
      1000,
      now
    )
    poller.start()
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(2) // one tick per interval, not two
    poller.stop()
  })

  it('refresh forces an immediate out-of-band fetch', async () => {
    let n = 0
    const poller = new OrcaPoller(async () => ++n, 60_000, now)
    const events = collect(poller)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.at(-1)?.value).toBe(1)
    clock = 1500
    poller.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.at(-1)).toEqual({ value: 2, updatedAt: 1500 })
    poller.stop()
  })

  it('stops cleanly: no further emits after stop, and start after stop is a no-op', async () => {
    let n = 0
    const poller = new OrcaPoller(async () => ++n, 1000, now)
    const events = collect(poller)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    const countAfterFirst = events.length
    poller.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(events.length).toBe(countAfterFirst)
    poller.start() // stopped poller refuses to restart
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.length).toBe(countAfterFirst)
  })
})
