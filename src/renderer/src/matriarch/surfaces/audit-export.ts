// Pure logic for the R4 Guardrails "immutable audit log export" (PRD FR32). The
// inbox is already an append-only message trail the backend provides today, so an
// export needs NO backend addition - it is a deterministic serialization of the
// messages the portal already holds. Kept pure + tested so the CSV/NDJSON shape,
// the chronological ordering, and the CSV escaping are proven without a DOM. The
// thin UI layer (a download button) calls toCsv/toNdjson and hands the string to
// a Blob; that wiring is trivial and backend-free.

import type { Message } from '../backend'

/** One flattened, export-ready audit row (stable column order). */
export type AuditRow = {
  sequence: number | ''
  createdAt: string
  from: string
  to: string
  type: string
  priority: string
  subject: string
  body: string
}

/** The fixed column order for both CSV and the row object - the audit schema. */
export const AUDIT_COLUMNS: (keyof AuditRow)[] = [
  'sequence',
  'createdAt',
  'from',
  'to',
  'type',
  'priority',
  'subject',
  'body'
]

/**
 * Flatten + order the messages into audit rows, OLDEST-first (an audit log reads
 * chronologically forward, the opposite of the inbox view's newest-first). Sorts
 * by sequence when present, else createdAt, else stable. Pure: no input mutation.
 */
export function toAuditRows(messages: Message[]): AuditRow[] {
  const ordered = [...messages].sort(compareChronological)
  return ordered.map((message) => ({
    sequence: message.sequence ?? '',
    createdAt: message.createdAt ?? '',
    from: message.fromHandle,
    to: message.toHandle,
    type: message.type,
    priority: message.priority,
    subject: message.subject ?? '',
    body: message.body
  }))
}

/** Oldest-first: sequence, then createdAt, then stable (0). */
function compareChronological(a: Message, b: Message): number {
  if (a.sequence !== undefined && b.sequence !== undefined && a.sequence !== b.sequence) {
    return a.sequence - b.sequence
  }
  if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1
  }
  return 0
}

/** RFC-4180-style CSV: quote when needed, double embedded quotes. */
export function csvEscape(value: string | number): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** The messages as a CSV string (header + one row per message, oldest-first). */
export function toCsv(messages: Message[]): string {
  const rows = toAuditRows(messages)
  const header = AUDIT_COLUMNS.join(',')
  const lines = rows.map((row) => AUDIT_COLUMNS.map((col) => csvEscape(row[col])).join(','))
  return [header, ...lines].join('\n')
}

/** The messages as newline-delimited JSON (one audit row per line, oldest-first). */
export function toNdjson(messages: Message[]): string {
  return toAuditRows(messages)
    .map((row) => JSON.stringify(row))
    .join('\n')
}

/** A timestamped, filesystem-safe export filename for the chosen format. */
export function auditFilename(format: 'csv' | 'ndjson', now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `matriarch-audit-${stamp}.${format}`
}
