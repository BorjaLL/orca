// Pure inbox/audit-log derivations (PRD FR18), lifted out of inbox-view.tsx so the
// recipient list, per-type counts, filtering, and chronological ordering are
// directly unit-testable. The view is a thin render over these.

import type { Message, MessageType } from '../backend'

export type RecipientFilter = string // a handle, or 'all'
export type TypeFilter = MessageType | 'all'

/**
 * The recipient filter options: 'all' plus every handle that appears as a sender
 * OR a recipient, sorted, deduped. Drawn from the data so the list always resolves
 * to something selectable.
 */
export function collectRecipients(messages: Message[]): string[] {
  const set = new Set<string>()
  for (const m of messages) {
    set.add(m.toHandle)
    set.add(m.fromHandle)
  }
  return ['all', ...[...set].sort()]
}

/** Count messages of a type (or all). Used for the per-type filter badges. */
export function countByType(messages: Message[], type: TypeFilter): number {
  return messages.filter((m) => type === 'all' || m.type === type).length
}

/** Does a message match the active recipient + type filters? */
export function matchesFilter(
  message: Message,
  recipient: RecipientFilter,
  type: TypeFilter
): boolean {
  const matchRecipient =
    recipient === 'all' || message.toHandle === recipient || message.fromHandle === recipient
  const matchType = type === 'all' || message.type === type
  return matchRecipient && matchType
}

/**
 * The audit trail in display order: filtered by recipient + type, then sorted
 * newest-first. Ordering prefers `sequence` (a monotonic per-thread counter the
 * backend assigns) and falls back to the `createdAt` timestamp; messages with
 * neither keep their incoming relative order (stable sort). An audit log reads
 * best most-recent-first, so a long inbox surfaces the latest activity at the top.
 */
export function orderInbox(
  messages: Message[],
  recipient: RecipientFilter,
  type: TypeFilter
): Message[] {
  const filtered = messages.filter((m) => matchesFilter(m, recipient, type))
  return filtered
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const byKey = sortKey(b.message) - sortKey(a.message)
      return byKey !== 0 ? byKey : a.index - b.index
    })
    .map((entry) => entry.message)
}

/** A comparable recency key: prefer the sequence number, else the parsed timestamp. */
function sortKey(message: Message): number {
  if (typeof message.sequence === 'number') {
    return message.sequence
  }
  if (message.createdAt) {
    const ms = Date.parse(message.createdAt)
    if (!Number.isNaN(ms)) {
      return ms
    }
  }
  return Number.NEGATIVE_INFINITY
}
