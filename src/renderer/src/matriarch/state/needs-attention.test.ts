import { describe, expect, it } from 'vitest'
import { deriveNeedsAttention } from './needs-attention'
import type { AgentSnapshot, Gate, Message, Task } from '../backend'

const agent = (o: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  handle: 'term_a',
  paneKey: 'tab1:pane1',
  label: 'Agent A',
  state: 'working',
  prompt: '',
  stateStartedAt: 0,
  updatedAt: 0,
  isCoordinator: false,
  ...o
})

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

describe('deriveNeedsAttention — live agents (PRD Story 2.4)', () => {
  it('surfaces a waiting agent as amber and a blocked agent as red', () => {
    const items = deriveNeedsAttention({
      agents: [
        agent({
          handle: 'term_w',
          paneKey: 'p:w',
          state: 'waiting',
          lastAssistantMessage: 'need a key'
        }),
        agent({
          handle: 'term_b',
          paneKey: 'p:b',
          state: 'blocked',
          toolName: 'Bash',
          toolInput: 'pnpm i'
        })
      ]
    })
    const waiting = items.find((i) => i.id === 'agent:p:w')
    const blocked = items.find((i) => i.id === 'agent:p:b')
    expect(waiting).toMatchObject({ kind: 'waiting-agent', tone: 'amber', title: 'Agent waiting' })
    expect(waiting?.body).toBe('need a key')
    expect(blocked).toMatchObject({ kind: 'waiting-agent', tone: 'red', title: 'Agent blocked' })
    // Tool-using agents read their activity from the tool, not the message.
    expect(blocked?.body).toBe('Bash · pnpm i')
  })

  it('ignores working/done/idle agents and the coordinator', () => {
    const items = deriveNeedsAttention({
      agents: [
        agent({ paneKey: 'p:1', state: 'working' }),
        agent({ paneKey: 'p:2', state: 'done' }),
        agent({ paneKey: 'p:3', state: 'idle' }),
        agent({ paneKey: 'p:4', state: 'waiting', isCoordinator: true })
      ]
    })
    expect(items).toEqual([])
  })

  it('does not double-surface an agent whose handle already shows a blocked/failed task', () => {
    const items = deriveNeedsAttention({
      tasks: [
        {
          id: 't1',
          title: 'blocked task',
          spec: 's',
          status: 'blocked',
          deps: [],
          assigneeHandle: 'term_x'
        }
      ],
      agents: [agent({ handle: 'term_x', paneKey: 'p:x', state: 'waiting' })]
    })
    // The task row carries the incident; the agent on the same handle is suppressed.
    expect(items.map((i) => i.id)).toEqual(['task-blocked:t1'])
  })

  it('still surfaces an agent on a different handle than any task incident', () => {
    const items = deriveNeedsAttention({
      tasks: [
        {
          id: 't1',
          title: 'blocked',
          spec: 's',
          status: 'blocked',
          deps: [],
          assigneeHandle: 'term_x'
        }
      ],
      agents: [agent({ handle: 'term_y', paneKey: 'p:y', state: 'blocked' })]
    })
    expect(items.map((i) => i.id).sort()).toEqual(['agent:p:y', 'task-blocked:t1'])
  })

  it('sorts a red blocked-agent above an amber waiting-agent', () => {
    const items = deriveNeedsAttention({
      agents: [
        agent({ paneKey: 'p:w', state: 'waiting' }),
        agent({ paneKey: 'p:b', state: 'blocked' })
      ]
    })
    expect(items[0].tone).toBe('red')
    expect(items.at(-1)?.tone).toBe('amber')
  })

  it('falls back to label then handle for the body when no activity is present', () => {
    const labelled = deriveNeedsAttention({
      agents: [agent({ paneKey: 'p:1', state: 'waiting', label: 'Wire the board', prompt: '' })]
    })
    expect(labelled[0].body).toBe('Wire the board')
    const bare = deriveNeedsAttention({
      agents: [agent({ handle: 'term_z', paneKey: 'p:2', state: 'waiting', label: '', prompt: '' })]
    })
    expect(bare[0].body).toBe('term_z')
  })
})
