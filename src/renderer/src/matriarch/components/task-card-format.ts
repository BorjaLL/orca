import { formatAgo } from '../state/use-now'

// Presentational transforms for the task card's metadata row: a human-readable
// timestamp and a git-style short id. Kept pure (no React, no clock) so they're
// trivially testable; the card supplies `now`.

/** Git-style short id for the card foot: `task_89b2cceccaa5` → `#89b2cce`.
 *  The full id stays available via a title tooltip for correlation. */
export function shortTaskId(id: string): string {
  return `#${id.replace(/^task_/, '').slice(0, 7)}`
}

/** Relative "2d ago" / "just now" label from an ISO timestamp; '' when absent
 *  or unparseable, so the card renders nothing rather than "Invalid Date". */
export function formatTimestampAgo(iso: string | undefined, now: number): string {
  if (!iso) {
    return ''
  }
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    return ''
  }
  const ago = formatAgo(ms, now)
  return ago === 'now' ? 'just now' : `${ago} ago`
}

/** Absolute, locale-formatted time for the hover tooltip; '' when unparseable. */
export function formatTimestampAbsolute(iso: string | undefined): string {
  if (!iso) {
    return ''
  }
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString()
}
