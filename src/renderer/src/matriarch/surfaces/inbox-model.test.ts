import { describe, expect, it } from 'vitest'
import { collectRecipients, countByType, matchesFilter, orderInbox } from './inbox-model'
import type { Message } from '../backend'

const msg = (o: Partial<Message> = {}): Message => ({
  id: o.id ?? 'm',
  fromHandle: 'term_a',
  toHandle: 'term_coord',
  type: 'status',
  priority: 'normal',
  body: 'hi',
  ...o
})

describe('collectRecipients', () => {
  it('lists all + every sender and recipient handle, sorted and deduped', () => {
    const messages = [
      msg({ fromHandle: 'term_c', toHandle: 'term_a' }),
      msg({ fromHandle: 'term_a', toHandle: 'term_b' })
    ]
    expect(collectRecipients(messages)).toEqual(['all', 'term_a', 'term_b', 'term_c'])
  })
  it('is just all for an empty inbox', () => {
    expect(collectRecipients([])).toEqual(['all'])
  })
})

describe('countByType', () => {
  const messages = [msg({ type: 'escalation' }), msg({ type: 'status' }), msg({ type: 'status' })]
  it('counts a specific type', () => {
    expect(countByType(messages, 'status')).toBe(2)
    expect(countByType(messages, 'escalation')).toBe(1)
    expect(countByType(messages, 'merge_ready')).toBe(0)
  })
  it('all counts everything', () => {
    expect(countByType(messages, 'all')).toBe(3)
  })
})

describe('matchesFilter', () => {
  const m = msg({ fromHandle: 'term_a', toHandle: 'term_coord', type: 'escalation' })
  it('all/all matches anything', () => {
    expect(matchesFilter(m, 'all', 'all')).toBe(true)
  })
  it('matches a recipient on either the from or the to side', () => {
    expect(matchesFilter(m, 'term_a', 'all')).toBe(true)
    expect(matchesFilter(m, 'term_coord', 'all')).toBe(true)
    expect(matchesFilter(m, 'term_other', 'all')).toBe(false)
  })
  it('matches the type', () => {
    expect(matchesFilter(m, 'all', 'escalation')).toBe(true)
    expect(matchesFilter(m, 'all', 'status')).toBe(false)
  })
  it('requires both filters to match', () => {
    expect(matchesFilter(m, 'term_a', 'escalation')).toBe(true)
    expect(matchesFilter(m, 'term_a', 'status')).toBe(false)
  })
})

describe('orderInbox — filter + newest-first', () => {
  it('orders by sequence descending when present', () => {
    const messages = [
      msg({ id: 'a', sequence: 1 }),
      msg({ id: 'b', sequence: 3 }),
      msg({ id: 'c', sequence: 2 })
    ]
    expect(orderInbox(messages, 'all', 'all').map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('orders by createdAt descending when there is no sequence', () => {
    const messages = [
      msg({ id: 'old', createdAt: '2026-06-01T10:00:00Z' }),
      msg({ id: 'new', createdAt: '2026-06-09T10:00:00Z' }),
      msg({ id: 'mid', createdAt: '2026-06-05T10:00:00Z' })
    ]
    expect(orderInbox(messages, 'all', 'all').map((m) => m.id)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps incoming order for messages with neither sequence nor timestamp (stable)', () => {
    const messages = [msg({ id: 'first' }), msg({ id: 'second' }), msg({ id: 'third' })]
    expect(orderInbox(messages, 'all', 'all').map((m) => m.id)).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  it('applies the recipient + type filters before ordering', () => {
    const messages = [
      msg({ id: 'keep', fromHandle: 'term_x', type: 'escalation', sequence: 1 }),
      msg({ id: 'wrong-type', fromHandle: 'term_x', type: 'status', sequence: 2 }),
      msg({ id: 'wrong-handle', fromHandle: 'term_y', type: 'escalation', sequence: 3 })
    ]
    expect(orderInbox(messages, 'term_x', 'escalation').map((m) => m.id)).toEqual(['keep'])
  })

  it('does not mutate the input array', () => {
    const messages = [msg({ id: 'a', sequence: 1 }), msg({ id: 'b', sequence: 2 })]
    const snapshot = messages.map((m) => m.id)
    orderInbox(messages, 'all', 'all')
    expect(messages.map((m) => m.id)).toEqual(snapshot)
  })
})
