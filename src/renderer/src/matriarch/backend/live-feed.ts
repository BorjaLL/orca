import type { FeedEvent, LiveFeed, Unsubscribe } from './matriarch-backend'

/**
 * A multicast value holder backing a LiveFeed. Adapters push new values into it
 * (from a WS stream or a poll tick); subscribers get the latest value on
 * subscribe and every change after. Tracks freshness so the UI can label state
 * honestly. One source can fan out to many subscribers without re-fetching.
 */
export class FeedSource<T> {
  private listeners = new Set<(event: FeedEvent<T>) => void>()
  private current: FeedEvent<T> | null = null

  constructor(
    public readonly isLive: boolean,
    public readonly pollIntervalMs?: number
  ) {}

  /** Latest event, or null before the first emit. */
  get latest(): FeedEvent<T> | null {
    return this.current
  }

  /** Publish a fresh value to all subscribers. */
  emit(value: T, updatedAt: number): void {
    this.current = { value, updatedAt }
    this.fanout()
  }

  /** Publish an error while keeping the last-known value (for Stale/Error states). */
  emitError(code: string, message: string, updatedAt: number): void {
    this.current = {
      value: this.current?.value as T,
      updatedAt: this.current?.updatedAt ?? updatedAt,
      error: { code, message }
    }
    this.fanout()
  }

  subscribe(listener: (event: FeedEvent<T>) => void): Unsubscribe {
    this.listeners.add(listener)
    if (this.current) {
      listener(this.current)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  private fanout(): void {
    if (!this.current) {
      return
    }
    for (const listener of this.listeners) {
      listener(this.current)
    }
  }
}

/** Wrap a FeedSource as the read-only LiveFeed the UI consumes. */
export function asLiveFeed<T>(source: FeedSource<T>): LiveFeed<T> {
  return {
    isLive: source.isLive,
    pollIntervalMs: source.pollIntervalMs,
    subscribe: (listener) => source.subscribe(listener)
  }
}
