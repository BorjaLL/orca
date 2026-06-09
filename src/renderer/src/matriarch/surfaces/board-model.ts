// Pure derivations for the unified Board, lifted out of board-view.tsx so the
// bucketing, DAG edge summary, combined freshness, and content-state machine are
// directly unit-testable (the view is a thin render over these).

import type { WorkItem } from '../state/work-items'
import { WORK_COLUMN_ORDER, type WorkColumn } from '../components/status-vocabulary'

/** A minimal feed-state shape — the fields the Board reads off each useLiveFeed. */
export type BoardFeedState = {
  value: unknown
  updatedAt: number | null
  pollIntervalMs?: number
  hasLoaded?: boolean
  error?: { message: string } | null
}

export type BoardContentState = 'loading' | 'error' | 'empty' | 'content'

/** Bucket work items into the fixed column order; every column is present (possibly empty). */
export function groupByColumn(items: WorkItem[]): Map<WorkColumn, WorkItem[]> {
  const map = new Map<WorkColumn, WorkItem[]>()
  for (const column of WORK_COLUMN_ORDER) {
    map.set(column, [])
  }
  for (const item of items) {
    map.get(item.column)?.push(item)
  }
  return map
}

/**
 * DAG edge summary among task-backed cards only (terminals/agents have no edges).
 * `dep -> task` for dependency edges, `parent ~> task` for decomposition edges.
 * ASCII arrows here; the view may render them with nicer glyphs.
 */
export function summarizeEdges(items: WorkItem[]): string[] {
  const edges: string[] = []
  for (const item of items) {
    const task = item.task
    if (!task) {
      continue
    }
    for (const dep of task.deps) {
      edges.push(`${dep} -> ${task.id}`)
    }
    if (task.parentId) {
      edges.push(`${task.parentId} ~> ${task.id}`)
    }
  }
  return edges
}

/**
 * Combine several feeds into one honest freshness pair. The Board reads multiple
 * feeds, some polled, so it is never "live": report the OLDEST update (the board
 * is only as fresh as its stalest feed) and the SLOWEST poll cadence (so overdue
 * tolerance is generous enough not to false-alarm).
 */
export function combineFreshness(states: BoardFeedState[]): {
  updatedAt: number | null
  pollIntervalMs?: number
} {
  const updatedAts = states.map((s) => s.updatedAt).filter((n): n is number => n !== null)
  const updatedAt = updatedAts.length > 0 ? Math.min(...updatedAts) : null
  const intervals = states.map((s) => s.pollIntervalMs ?? 0)
  const slowest = Math.max(0, ...intervals)
  return { updatedAt, pollIntervalMs: slowest || undefined }
}

/**
 * The Board's content-state machine:
 * - **loading** until at least one feed has loaded or produced a value.
 * - **error** when every feed errored with no last-known value (nothing to show).
 * - **empty** when feeds are healthy but produced no work items.
 * - **content** otherwise.
 * A single healthy feed (with a value) is enough to leave loading/error, so a
 * partial backend still shows what it can rather than a blank error.
 */
export function deriveBoardContentState(
  states: BoardFeedState[],
  itemCount: number
): BoardContentState {
  const anyLoaded = states.some((s) => s.hasLoaded || s.value !== null)
  if (!anyLoaded) {
    return 'loading'
  }
  if (states.every((s) => s.error && !s.value)) {
    return 'error'
  }
  return itemCount === 0 ? 'empty' : 'content'
}

/** The first available feed error message, for the error surface. */
export function firstErrorMessage(states: BoardFeedState[], fallback: string): string {
  return states.find((s) => s.error)?.error?.message ?? fallback
}
