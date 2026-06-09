import { useEffect, useState } from 'react'
import type { LiveFeed } from '../backend'

export type LiveFeedState<T> = {
  /** Latest value, or null before the first emit (Loading). */
  value: T | null
  /** ms epoch of the latest value; null before first emit. */
  updatedAt: number | null
  /** Set when the last fetch/subscribe attempt failed. */
  error: { code: string; message: string } | null
  /** True once at least one value (or error) has arrived. */
  hasLoaded: boolean
  /** Whether this feed is genuinely push-live (vs interval-polled). */
  isLive: boolean
  pollIntervalMs?: number
}

/**
 * Bridge a LiveFeed<T> into React state. Pass a STABLE feed (memoize it in the
 * caller with useMemo) so we don't re-subscribe every render. The feed emits its
 * current value on subscribe, so the first state update is synchronous-ish.
 */
export function useLiveFeed<T>(feed: LiveFeed<T>): LiveFeedState<T> {
  const [state, setState] = useState<LiveFeedState<T>>(() => ({
    value: null,
    updatedAt: null,
    error: null,
    hasLoaded: false,
    isLive: feed.isLive,
    pollIntervalMs: feed.pollIntervalMs
  }))

  useEffect(() => {
    const unsubscribe = feed.subscribe((event) => {
      setState({
        value: event.value ?? null,
        updatedAt: event.updatedAt,
        error: event.error ?? null,
        hasLoaded: true,
        isLive: feed.isLive,
        pollIntervalMs: feed.pollIntervalMs
      })
    })
    return unsubscribe
  }, [feed])

  return state
}

export type ContentState = 'loading' | 'error' | 'empty' | 'content'

/**
 * Resolve which body to render from a feed state. `isEmpty` decides Empty vs
 * Content for the loaded value. Error only wins when there's no last-known value
 * to show (otherwise the surface stays usable and the staleness chrome carries
 * the error — per the design state matrix: "keep chrome usable").
 */
export function resolveContentState<T>(
  state: LiveFeedState<T>,
  isEmpty: (value: T) => boolean
): ContentState {
  if (!state.hasLoaded && !state.value) {
    return 'loading'
  }
  if (state.error && !state.value) {
    return 'error'
  }
  if (state.value !== null && isEmpty(state.value)) {
    return 'empty'
  }
  return 'content'
}
