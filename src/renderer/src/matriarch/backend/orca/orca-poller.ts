import { FeedSource } from '../live-feed'

/**
 * Drives a poll-backed FeedSource: fetches on an interval, fans the result out
 * to subscribers, and keeps the last-known value on error (so the UI shows
 * Stale/Error, never a flash of empty). Polling only runs while at least one
 * subscriber is attached — there is no event stream for tasks/gates/inbox today,
 * so this is the honest "near-live" mechanism (PRD FR14 / §4.3).
 */
export class OrcaPoller<T> {
  readonly source: FeedSource<T>
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight = false
  private stopped = false

  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly intervalMs: number,
    private readonly now: () => number = () => Date.now()
  ) {
    this.source = new FeedSource<T>(false, intervalMs)
  }

  /** Begin polling immediately, then every intervalMs. Idempotent. */
  start(): void {
    if (this.timer || this.stopped) {
      return
    }
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  /** Force an immediate refresh (e.g. the user hit Retry / manual refresh). */
  refresh(): void {
    void this.tick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.stopped) {
      return
    }
    this.inFlight = true
    try {
      const value = await this.fetcher()
      if (!this.stopped) {
        this.source.emit(value, this.now())
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.source.emitError('poll_failed', message, this.now())
    } finally {
      this.inFlight = false
    }
  }
}
