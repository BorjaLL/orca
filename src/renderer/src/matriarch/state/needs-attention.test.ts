import { describe, expect, it } from 'vitest'
import { deriveNeedsAttention } from './needs-attention'
import type { Gate, Message, Task } from '../backend'

describe('deriveNeedsAttention', () => {
  it('surfaces pending gates, escalations, failed and blocked tasks', () => {
    const gates: Gate[] = [
      {
        id: 'g1',
        taskId: 't_block',
        question: 'Which store?',
        options: [],
        status: 'pending',
        toHandle: 'term_3b'
      },
      { id: 'g0', taskId: 't_done', question: 'resolved one', options: [], status: 'resolved' }
    ]
    const messages: Message[] = [
      {
        id: 'm1',
        fromHandle: 'term_7c',
        toHandle: 'term_coord',
        type: 'escalation',
        priority: 'urgent',
        body: 'circuit broke'
      },
      { id: 'm2', fromHandle: 'a', toHandle: 'b', type: 'status', priority: 'normal', body: 'fyi' }
    ]
    const tasks: Task[] = [
      {
        id: 't_fail',
        title: 'f',
        spec: 'f',
        status: 'failed',
        deps: [],
        attempts: '3/3',
        result: 'boom'
      },
      { id: 't_block', title: 'b', spec: 'b', status: 'blocked', deps: [] },
      { id: 't_ok', title: 'o', spec: 'o', status: 'completed', deps: [] }
    ]
    const items = deriveNeedsAttention({ tasks, gates, messages })
    const ids = items.map((i) => i.id)
    expect(ids).toContain('gate:g1')
    expect(ids).toContain('esc:m1')
    expect(ids).toContain('task-failed:t_fail')
    expect(ids).toContain('task-blocked:t_block')
    // resolved gate, status message, completed task are NOT surfaced
    expect(ids).not.toContain('gate:g0')
    expect(ids).not.toContain('esc:m2')
    expect(ids.some((i) => i.includes('t_ok'))).toBe(false)
  })

  it('sorts red (failure/escalation) above amber (waiting)', () => {
    const items = deriveNeedsAttention({
      gates: [{ id: 'g1', taskId: 't', question: 'q', options: [], status: 'pending' }],
      messages: [
        {
          id: 'm1',
          fromHandle: 'x',
          toHandle: 'y',
          type: 'escalation',
          priority: 'urgent',
          body: 'b'
        }
      ]
    })
    expect(items[0].tone).toBe('red')
    expect(items.at(-1)?.tone).toBe('amber')
  })

  it('returns an empty list when nothing needs a human', () => {
    expect(deriveNeedsAttention({ tasks: [], gates: [], messages: [] })).toEqual([])
  })

  it('deep-links each item to its task and/or handle', () => {
    const items = deriveNeedsAttention({
      gates: [
        {
          id: 'g1',
          taskId: 't_x',
          question: 'q',
          options: [],
          status: 'pending',
          toHandle: 'term_3b'
        }
      ]
    })
    expect(items[0].taskId).toBe('t_x')
    expect(items[0].handle).toBe('term_3b')
  })
})
