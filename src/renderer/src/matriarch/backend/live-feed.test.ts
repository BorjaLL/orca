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

  it('latest is null before the first emit, then tracks the current event', () => {
    const source = new FeedSource<number>(true)
    expect(source.latest).toBeNull()
    source.emit(7, 100)
    expect(source.latest).toEqual({ value: 7, updatedAt: 100 })
  })

  it('does not replay anything to a subscriber that joins before the first emit', () => {
    const source = new FeedSource<number>(true)
    const listener = vi.fn()
    source.subscribe(listener)
    expect(listener).not.toHaveBeenCalled()
  })

  it('replays the error event to a subscriber that joins after a failure', () => {
    const source = new FeedSource<number>(false, 2000)
    source.emit(1, 10)
    source.emitError('poll_failed', 'down', 20)
    const late = vi.fn()
    source.subscribe(late)
    expect(late).toHaveBeenCalledWith({
      value: 1,
      updatedAt: 10,
      error: { code: 'poll_failed', message: 'down' }
    })
  })

  it('records an error before any value with an undefined value and the error timestamp', () => {
    const source = new FeedSource<number>(false, 2000)
    source.emitError('boot_failed', 'no value yet', 50)
    expect(source.latest).toEqual({
      value: undefined,
      updatedAt: 50,
      error: { code: 'boot_failed', message: 'no value yet' }
    })
  })

  it('a later successful emit clears the error for new subscribers', () => {
    const source = new FeedSource<number>(false, 2000)
    source.emit(1, 10)
    source.emitError('poll_failed', 'down', 20)
    source.emit(2, 30)
    const listener = vi.fn()
    source.subscribe(listener)
    expect(listener).toHaveBeenCalledWith({ value: 2, updatedAt: 30 })
    expect(source.latest?.error).toBeUndefined()
  })

  it('only the unsubscribed listener stops; the rest keep receiving', () => {
    const source = new FeedSource<number>(true)
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = source.subscribe(a)
    source.subscribe(b)
    unsubA()
    source.emit(9, 1)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith({ value: 9, updatedAt: 1 })
    expect(source.subscriberCount).toBe(1)
  })
})
