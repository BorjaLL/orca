import { describe, expect, it } from 'vitest'
import { resolveFreshness, STALE_AFTER_MS } from './freshness'
import type { ConnectionState } from '../backend'

const base = {
  connectionState: 'connected' as ConnectionState,
  isLive: true,
  updatedAt: 1000,
  now: 1000,
  pollIntervalMs: undefined as number | undefined
}

describe('resolveFreshness — priority ladder', () => {
  it('reconnecting wins over everything when the transport is down', () => {
    expect(resolveFreshness({ ...base, connectionState: 'disconnected' }).mode).toBe('reconnecting')
    expect(resolveFreshness({ ...base, connectionState: 'reconnecting' }).mode).toBe('reconnecting')
  })

  it('connecting while connecting, or before any data has arrived', () => {
    expect(resolveFreshness({ ...base, connectionState: 'connecting' }).mode).toBe('connecting')
    expect(resolveFreshness({ ...base, updatedAt: null }).mode).toBe('connecting')
  })

  it('live only when the feed truly pushes AND the data is fresh', () => {
    expect(resolveFreshness({ ...base, isLive: true, now: 1000 }).mode).toBe('live')
    // Fresh but polled → not live.
    expect(resolveFreshness({ ...base, isLive: false, now: 1000 }).mode).toBe('stale')
    // Live but gone quiet past the stale window → not live.
    expect(resolveFreshness({ ...base, isLive: true, now: 1000 + STALE_AFTER_MS }).mode).toBe(
      'stale'
    )
  })

  it('a live feed exactly at the stale threshold is no longer live', () => {
    expect(resolveFreshness({ ...base, now: 1000 + STALE_AFTER_MS }).mode).toBe('stale')
    expect(resolveFreshness({ ...base, now: 1000 + STALE_AFTER_MS - 1 }).mode).toBe('live')
  })
})

describe('resolveFreshness — overdue', () => {
  it('a polled feed is overdue past 3x its interval', () => {
    const poll = { ...base, isLive: false, pollIntervalMs: 2000, updatedAt: 0 }
    expect(resolveFreshness({ ...poll, now: 5000 }).overdue).toBe(false) // 5s < 6s
    expect(resolveFreshness({ ...poll, now: 7000 }).overdue).toBe(true) // 7s > 6s
  })

  it('falls back to the stale window when no poll interval is known', () => {
    const noInterval = { ...base, isLive: false, pollIntervalMs: undefined, updatedAt: 0 }
    expect(resolveFreshness({ ...noInterval, now: STALE_AFTER_MS - 1 }).overdue).toBe(false)
    expect(resolveFreshness({ ...noInterval, now: STALE_AFTER_MS + 1 }).overdue).toBe(true)
  })

  it('never reports a negative age for a clock that is behind the update', () => {
    const result = resolveFreshness({ ...base, isLive: false, updatedAt: 5000, now: 1000 })
    expect(result.ageMs).toBe(0)
  })
})
