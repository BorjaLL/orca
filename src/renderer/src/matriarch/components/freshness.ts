// Pure freshness/connection resolution for the shell's honest data-state label.
// Kept free of JSX so the priority ladder (Disconnected → Connecting → Live →
// Stale → polled) is directly unit-testable (PRD NFR4/NFR6: never label polled
// data as live, never present stale data as fresh).

import type { ConnectionState } from '../backend'

/** How long a live (push) feed may go quiet before it reads Stale, not Live. */
export const STALE_AFTER_MS = 12_000

export type FreshnessMode = 'reconnecting' | 'connecting' | 'live' | 'stale'

export type Freshness = {
  mode: FreshnessMode
  /** ms since the last update (0 when not yet applicable). */
  ageMs: number
  /** True only for a polled/stale feed that is overdue past its tolerance. */
  overdue: boolean
}

/**
 * Resolve the one freshness state to show, in strict priority order:
 * - **reconnecting** when the transport is down or reconnecting.
 * - **connecting** while connecting, or before any data has arrived.
 * - **live** when the feed truly pushes AND the data is fresh (< STALE_AFTER_MS).
 * - **stale** otherwise: a polled feed, or a live feed that went quiet. `overdue`
 *   is set when a polled feed exceeds 3x its interval (or STALE_AFTER_MS when no
 *   interval is known), so the UI can escalate it visually.
 */
export function resolveFreshness(input: {
  connectionState: ConnectionState
  isLive: boolean
  updatedAt: number | null
  now: number
  pollIntervalMs?: number
}): Freshness {
  const { connectionState, isLive, updatedAt, now, pollIntervalMs } = input

  if (connectionState === 'disconnected' || connectionState === 'reconnecting') {
    return { mode: 'reconnecting', ageMs: 0, overdue: false }
  }
  if (connectionState === 'connecting' || updatedAt === null) {
    return { mode: 'connecting', ageMs: 0, overdue: false }
  }

  const ageMs = Math.max(0, now - updatedAt)
  if (isLive && ageMs < STALE_AFTER_MS) {
    return { mode: 'live', ageMs, overdue: false }
  }

  const overdue = pollIntervalMs ? ageMs > pollIntervalMs * 3 : ageMs > STALE_AFTER_MS
  return { mode: 'stale', ageMs, overdue }
}
