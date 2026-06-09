import { describe, expect, it } from 'vitest'
import {
  AUDIT_COLUMNS,
  auditFilename,
  csvEscape,
  toAuditRows,
  toCsv,
  toNdjson
} from './audit-export'
import type { Message } from '../backend'

const msg = (o: Partial<Message> = {}): Message => ({
  id: o.id ?? 'm',
  fromHandle: 'term_a',
  toHandle: 'term_coord',
  type: 'status',
  priority: 'normal',
  body: 'hello',
  ...o
})

describe('toAuditRows — ordering (oldest-first)', () => {
  it('orders by sequence ascending', () => {
    const rows = toAuditRows([msg({ id: '2', sequence: 2 }), msg({ id: '1', sequence: 1 })])
    expect(rows.map((r) => r.sequence)).toEqual([1, 2])
  })
  it('falls back to createdAt ascending when sequence is absent', () => {
    const rows = toAuditRows([
      msg({ id: 'b', createdAt: '2026-06-09T11:00:00Z' }),
      msg({ id: 'a', createdAt: '2026-06-09T10:00:00Z' })
    ])
    expect(rows.map((r) => r.createdAt)).toEqual(['2026-06-09T10:00:00Z', '2026-06-09T11:00:00Z'])
  })
  it('does not mutate the input', () => {
    const input = [msg({ id: '2', sequence: 2 }), msg({ id: '1', sequence: 1 })]
    toAuditRows(input)
    expect(input.map((m) => m.id)).toEqual(['2', '1'])
  })
  it('flattens every audit column', () => {
    const [row] = toAuditRows([
      msg({
        sequence: 5,
        createdAt: 't',
        type: 'escalation',
        priority: 'high',
        subject: 's',
        body: 'b'
      })
    ])
    expect(row).toEqual({
      sequence: 5,
      createdAt: 't',
      from: 'term_a',
      to: 'term_coord',
      type: 'escalation',
      priority: 'high',
      subject: 's',
      body: 'b'
    })
  })
  it('uses empty strings for missing sequence/createdAt/subject', () => {
    const [row] = toAuditRows([msg()])
    expect(row.sequence).toBe('')
    expect(row.createdAt).toBe('')
    expect(row.subject).toBe('')
  })
})

describe('csvEscape', () => {
  it('passes through a plain value', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape(7)).toBe('7')
  })
  it('quotes + doubles embedded quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
  })
  it('quotes values with commas or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('toCsv', () => {
  it('starts with the audit header in column order', () => {
    const csv = toCsv([])
    expect(csv).toBe(AUDIT_COLUMNS.join(','))
  })
  it('emits one escaped row per message, oldest-first', () => {
    const csv = toCsv([
      msg({ id: '2', sequence: 2, body: 'second' }),
      msg({ id: '1', sequence: 1, body: 'has, comma' })
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[1]).toContain('"has, comma"')
    expect(lines[1]).toContain('1,')
    expect(lines[2]).toContain('second')
  })
})

describe('toNdjson', () => {
  it('is one JSON audit row per line, oldest-first, parseable', () => {
    const ndjson = toNdjson([msg({ id: '2', sequence: 2 }), msg({ id: '1', sequence: 1 })])
    const rows = ndjson.split('\n').map((line) => JSON.parse(line))
    expect(rows.map((r) => r.sequence)).toEqual([1, 2])
    expect(rows[0].from).toBe('term_a')
  })
  it('is empty for no messages', () => {
    expect(toNdjson([])).toBe('')
  })
})

describe('auditFilename', () => {
  it('is timestamped and filesystem-safe per format', () => {
    const at = Date.parse('2026-06-09T10:35:00Z')
    expect(auditFilename('csv', at)).toBe('matriarch-audit-2026-06-09T10-35-00-000Z.csv')
    expect(auditFilename('ndjson', at)).toBe('matriarch-audit-2026-06-09T10-35-00-000Z.ndjson')
  })
})
