import { describe, expect, it } from 'vitest'
import type { AgentSnapshot, Task, TerminalSummary } from '../backend'
import {
  buildWorkItems,
  deriveColumn,
  deriveDisplayConfig,
  REVIEW_SHIP_RECENCY_MS
} from './work-items'
import { WORK_COLUMN_CONFIG } from '../components/status-vocabulary'

const NOW = 1_700_000_000_000
const recent = NOW - 60_000 // 1 min ago — inside the recency window
const stale = NOW - REVIEW_SHIP_RECENCY_MS - 60_000 // just past it

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Task one',
  spec: 'do x',
  status: 'pending',
  deps: [],
  ...o
})
const agent = (o: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  handle: 'a1',
  paneKey: 'pane1',
  label: 'Agent one',
  state: 'working',
  prompt: '',
  stateStartedAt: NOW,
  updatedAt: NOW,
  isCoordinator: false,
  ...o
})
const terminal = (o: Partial<TerminalSummary> = {}): TerminalSummary => ({
  handle: 'sh1',
  paneKey: 'panesh1',
  connected: true,
  lastOutputAt: NOW,
  ...o
})

describe('buildWorkItems — terminal-first', () => {
  it('emits one card per terminal, folding the agent + task in (no separate agent/task cards)', () => {
    const t = task({ id: 'tc', status: 'dispatched', assigneeHandle: 'a1', title: 'Wire ports' })
    const a = agent({ handle: 'a1', paneKey: 'pane1', taskId: 'tc', state: 'working' })
    const term = terminal({ handle: 'a1', paneKey: 'pane1', worktreeName: 'wt', branch: 'b' })
    const items = buildWorkItems([t], [a], [term], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('terminal')
    expect(items[0].id).toBe('terminal:pane1')
    expect(items[0].agent?.handle).toBe('a1')
    expect(items[0].task?.id).toBe('tc')
    expect(items[0].column).toBe('working')
    expect(items[0].chip).toMatchObject({ handle: 'a1', branch: 'b', agentBacked: true })
  })

  it('joins an agent to its terminal by paneKey when handles differ', () => {
    const a = agent({ handle: 'a1', paneKey: 'pane1' })
    const term = terminal({ handle: 'term_other', paneKey: 'pane1', worktreeName: 'joined' })
    const items = buildWorkItems([], [a], [term], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('terminal')
    expect(items[0].agent?.handle).toBe('a1')
    expect(items[0].title).toBe('joined')
  })

  it('keeps a live agent with no terminal row as its own card (never drops it)', () => {
    const a = agent({ handle: 'a1', paneKey: 'pane1', state: 'waiting', label: 'No-term agent' })
    const items = buildWorkItems([], [a], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('agent')
    expect(items[0].id).toBe('agent:pane1')
    expect(items[0].column).toBe('needs-you')
  })

  it('does not double-show an agent that has a terminal', () => {
    const a = agent({ handle: 'a1', paneKey: 'pane1' })
    const term = terminal({ handle: 'a1', paneKey: 'pane1' })
    const items = buildWorkItems([], [a], [term], NOW)
    expect(items).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'agent')).toHaveLength(0)
  })

  it('surfaces a genuine plain shell as a parked terminal card (worktree leads the title)', () => {
    const term = terminal({
      handle: 'sh1',
      paneKey: 'p',
      worktreeName: 'homelab',
      title: 'zsh',
      preview: '$ ls'
    })
    const items = buildWorkItems([], [], [term], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('terminal')
    expect(items[0].column).toBe('parked')
    expect(items[0].id).toBe('terminal:p')
    expect(items[0].title).toBe('homelab')
    expect(items[0].summary).toBe('$ ls')
    expect(items[0].chip).toMatchObject({ handle: 'sh1', agentBacked: false })
  })

  it('shows queued (pending/ready) tasks with no pane as Todo cards', () => {
    const items = buildWorkItems([task({ id: 'tq', status: 'ready' })], [], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('task')
    expect(items[0].id).toBe('task:tq')
    expect(items[0].column).toBe('todo')
  })

  it('keeps a failed task with no pane in Needs you', () => {
    const items = buildWorkItems([task({ id: 'tf', status: 'failed' })], [], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].column).toBe('needs-you')
  })

  it('drops completed tasks whose pane is gone so Review & ship stays current', () => {
    const items = buildWorkItems(
      [task({ id: 'td', status: 'completed', completedAt: '2020-01-01T00:00:00Z' })],
      [],
      [],
      NOW
    )
    expect(items).toHaveLength(0)
  })

  it('effective note: explicit terminal note wins; otherwise the task title', () => {
    const t = task({
      id: 'tc',
      status: 'dispatched',
      assigneeHandle: 'a1',
      title: 'Wire the ports field'
    })
    const a = agent({ handle: 'a1', paneKey: 'pane1', taskId: 'tc' })
    const withNote = buildWorkItems(
      [t],
      [a],
      [terminal({ handle: 'a1', paneKey: 'pane1', note: 'explicit note' })],
      NOW
    )
    expect(withNote[0].note).toBe('explicit note')
    const withoutNote = buildWorkItems(
      [t],
      [a],
      [terminal({ handle: 'a1', paneKey: 'pane1' })],
      NOW
    )
    expect(withoutNote[0].note).toBe('Wire the ports field')
  })

  it('emits terminals → paneless agents → queued tasks in order', () => {
    const items = buildWorkItems(
      [task({ id: 'tq', status: 'ready' })],
      [agent({ handle: 'a1', paneKey: 'pane1', state: 'waiting' })],
      [terminal({ handle: 'sh1', paneKey: 'p' })],
      NOW
    )
    expect(items.map((i) => i.kind)).toEqual(['terminal', 'agent', 'task'])
  })
})

describe('deriveColumn — agent state wins the attention split, done decays by recency', () => {
  it('waiting/blocked agent → needs-you even when the task is dispatched', () => {
    expect(
      deriveColumn(agent({ state: 'waiting' }), task({ status: 'dispatched' }), NOW, NOW)
    ).toBe('needs-you')
    expect(
      deriveColumn(agent({ state: 'blocked' }), task({ status: 'dispatched' }), NOW, NOW)
    ).toBe('needs-you')
  })
  it('working agent → working; but a failed/blocked task → needs-you', () => {
    expect(
      deriveColumn(agent({ state: 'working' }), task({ status: 'dispatched' }), NOW, NOW)
    ).toBe('working')
    expect(deriveColumn(agent({ state: 'working' }), task({ status: 'failed' }), NOW, NOW)).toBe(
      'needs-you'
    )
  })
  it('done agent decays: recent → review-ship, stale → parked', () => {
    expect(deriveColumn(agent({ state: 'done' }), undefined, recent, NOW)).toBe('review-ship')
    expect(deriveColumn(agent({ state: 'done' }), undefined, stale, NOW)).toBe('parked')
  })
  it('idle agent: no task → parked; dispatched task → working; completed recent → review-ship', () => {
    expect(deriveColumn(agent({ state: 'idle' }), undefined, NOW, NOW)).toBe('parked')
    expect(deriveColumn(agent({ state: 'idle' }), task({ status: 'dispatched' }), NOW, NOW)).toBe(
      'working'
    )
    expect(deriveColumn(agent({ state: 'idle' }), task({ status: 'completed' }), recent, NOW)).toBe(
      'review-ship'
    )
  })
  it('task-only statuses map to the right columns (completed decays)', () => {
    expect(deriveColumn(undefined, task({ status: 'pending' }), NOW, NOW)).toBe('todo')
    expect(deriveColumn(undefined, task({ status: 'ready' }), NOW, NOW)).toBe('todo')
    expect(deriveColumn(undefined, task({ status: 'dispatched' }), NOW, NOW)).toBe('working')
    expect(deriveColumn(undefined, task({ status: 'blocked' }), NOW, NOW)).toBe('needs-you')
    expect(deriveColumn(undefined, task({ status: 'failed' }), NOW, NOW)).toBe('needs-you')
    expect(deriveColumn(undefined, task({ status: 'completed' }), recent, NOW)).toBe('review-ship')
    expect(deriveColumn(undefined, task({ status: 'completed' }), stale, NOW)).toBe('parked')
  })
  it('a plain terminal (no task, no agent) parks', () => {
    expect(deriveColumn(undefined, undefined, null, NOW)).toBe('parked')
  })
})

describe('deriveColumn — a running process is working; orphaned dispatches need you', () => {
  it('a busy terminal is working even when its agent reported done/idle', () => {
    const ctx = { busy: true, hasLivePane: true }
    expect(deriveColumn(agent({ state: 'done' }), undefined, recent, NOW, ctx)).toBe('working')
    expect(deriveColumn(agent({ state: 'idle' }), undefined, NOW, NOW, ctx)).toBe('working')
  })
  it('a busy plain shell (no agent, no task) is working, not parked', () => {
    expect(deriveColumn(undefined, undefined, NOW, NOW, { busy: true })).toBe('working')
  })
  it('a blocked/waiting agent still needs you even with a running process', () => {
    expect(deriveColumn(agent({ state: 'blocked' }), undefined, recent, NOW, { busy: true })).toBe(
      'needs-you'
    )
  })
  it('a dispatched task with a live pane stays working; an orphaned stale one needs you', () => {
    const dispatched = task({ status: 'dispatched' })
    // Live pane backing it (e.g. terminal-with-task, no agent) → working even if stale.
    expect(deriveColumn(undefined, dispatched, stale, NOW, { hasLivePane: true })).toBe('working')
    // No live pane + fresh → still working briefly (the pane may be spawning).
    expect(deriveColumn(undefined, dispatched, recent, NOW, { hasLivePane: false })).toBe('working')
    // No live pane + stale → orphaned dispatch, surface in Needs you.
    expect(deriveColumn(undefined, dispatched, stale, NOW, { hasLivePane: false })).toBe(
      'needs-you'
    )
  })
})

describe('deriveDisplayConfig — live spin only for genuine activity', () => {
  it('a busy pane shows the working spinner even when the agent reports done', () => {
    expect(
      deriveDisplayConfig(agent({ state: 'done' }), undefined, 'working', { busy: true })
    ).toBe(WORK_COLUMN_CONFIG.working)
  })
  it('an orphaned dispatch in Needs you shows the amber attention glyph, not a spinner', () => {
    expect(deriveDisplayConfig(undefined, task({ status: 'dispatched' }), 'needs-you')).toBe(
      WORK_COLUMN_CONFIG['needs-you']
    )
  })
  it('a live dispatched task with a pane keeps the dispatched spinner', () => {
    const config = deriveDisplayConfig(undefined, task({ status: 'dispatched' }), 'working')
    expect(config.spin).toBe(true)
  })
})

describe('buildWorkItems — busy terminal integration', () => {
  it('a finished agent with a running foreground process lands in Working with a live glyph', () => {
    const a = agent({ handle: 'a1', paneKey: 'pane1', state: 'done' })
    const term = terminal({ handle: 'a1', paneKey: 'pane1', hasRunningProcess: true })
    const items = buildWorkItems([], [a], [term], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].column).toBe('working')
    expect(items[0].config.tone).toBe('blue')
  })
})
