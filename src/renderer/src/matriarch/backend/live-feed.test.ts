import { describe, expect, it, vi } from 'vitest'
import { asLiveFeed, FeedSource } from './live-feed'

describe('FeedSource', () => {
  it('replays the current value to a new subscriber', () => {
    const source = new FeedSource<number>(true)
    source.emit(42, 1000)
    const listener = vi.fn()
    source.subscribe(listener)
    expect(listener).toHaveBeenCalledWith({ value: 42, updatedAt: 1000 })
  })

  it('multicasts to all subscribers without re-fetching', () => {
    const source = new FeedSource<string>(false, 2000)
    const a = vi.fn()
    const b = vi.fn()
    source.subscribe(a)
    source.subscribe(b)
    source.emit('hello', 5)
    expect(a).toHaveBeenCalledWith({ value: 'hello', updatedAt: 5 })
    expect(b).toHaveBeenCalledWith({ value: 'hello', updatedAt: 5 })
    expect(source.subscriberCount).toBe(2)
  })

  it('keeps the last-known value on error (Stale/Error state)', () => {
    const source = new FeedSource<number[]>(false, 2000)
    source.emit([1, 2, 3], 10)
    const listener = vi.fn()
    source.subscribe(listener)
    source.emitError('poll_failed', 'network down', 20)
    expect(listener).toHaveBeenLastCalledWith({
      value: [1, 2, 3],
      updatedAt: 10,
      error: { code: 'poll_failed', message: 'network down' }
    })
  })

  it('stops notifying after unsubscribe', () => {
    const source = new FeedSource<number>(true)
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    unsubscribe()
    source.emit(1, 1)
    expect(listener).not.toHaveBeenCalled()
    expect(source.subscriberCount).toBe(0)
  })

  it('exposes isLive + pollIntervalMs through asLiveFeed', () => {
    const live = asLiveFeed(new FeedSource<number>(true))
    expect(live.isLive).toBe(true)
    const polled = asLiveFeed(new FeedSource<number>(false, 3000))
    expect(polled.isLive).toBe(false)
    expect(polled.pollIntervalMs).toBe(3000)
  })
})
