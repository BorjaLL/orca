/* oxlint-disable max-lines -- Why: the exhaustive wire→domain mapper cases (task/gate/
   message/agent/terminal) are co-located; splitting would scatter closely-related assertions. */
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import {
  collectCoordinatorHandles,
  deriveCoordinatorState,
  deriveTaskHistory,
  deriveWorktreeName,
  mapAgentSnapshot,
  mapGate,
  mapMessage,
  mapTask,
  mapTerminalSummary,
  parseStringArray,
  shortBranchName,
  type AgentMapContext
} from './orca-mappers'
import type {
  OrcaGateRow,
  OrcaMessageRow,
  OrcaTaskRow,
  OrcaTerminalSummary
} from './orca-wire-types'
import type { Task } from '../matriarch-types'

describe('parseStringArray', () => {
  it('parses a JSON string array', () => {
    expect(parseStringArray('["a","b"]')).toEqual(['a', 'b'])
  })
  it('returns [] for null/empty/malformed', () => {
    expect(parseStringArray(null)).toEqual([])
    expect(parseStringArray('')).toEqual([])
    expect(parseStringArray('not json')).toEqual([])
    expect(parseStringArray('{"a":1}')).toEqual([])
  })
  it('drops non-string members', () => {
    expect(parseStringArray('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })
})

describe('mapTask', () => {
  const base: OrcaTaskRow = {
    id: 'task_cc06',
    parent_id: null,
    created_by_terminal_handle: 'term_coord',
    spec: 'Add a workspace-ports status line to orca status --json.',
    status: 'dispatched',
    deps: '["task_aa01"]',
    result: null,
    created_at: '2026-05-30T10:00:00Z',
    completed_at: null,
    assignee_handle: 'term_4f',
    dispatch_id: 'disp_01'
  }

  it('maps wire row → portal Task with a derived title', () => {
    const task = mapTask(base)
    expect(task.id).toBe('task_cc06')
    expect(task.title).toBe('Add a workspace-ports status line to orca status --json')
    expect(task.spec).toBe(base.spec)
    expect(task.status).toBe('dispatched')
    expect(task.deps).toEqual(['task_aa01'])
    expect(task.assigneeHandle).toBe('term_4f')
    expect(task.dispatchId).toBe('disp_01')
  })

  it('normalizes nulls to undefined', () => {
    const task = mapTask({ ...base, result: null, completed_at: null, parent_id: null })
    expect(task.result).toBeUndefined()
    expect(task.completedAt).toBeUndefined()
    expect(task.parentId).toBeUndefined()
  })
})

describe('mapGate', () => {
  it('maps gate row + parses options', () => {
    const row: OrcaGateRow = {
      id: 'gate_01',
      task_id: 'task_ff14',
      question: 'Which backing store?',
      options: '["SQLite","In-memory"]',
      status: 'pending',
      resolution: null,
      created_at: '2026-05-30T10:21:00Z',
      resolved_at: null
    }
    const gate = mapGate(row)
    expect(gate.options).toEqual(['SQLite', 'In-memory'])
    expect(gate.status).toBe('pending')
    expect(gate.resolution).toBeUndefined()
  })
})

describe('mapMessage', () => {
  it('maps message row preserving type + priority', () => {
    const row: OrcaMessageRow = {
      id: 'msg_05',
      from_handle: 'term_7c',
      to_handle: 'term_coord',
      subject: 'escalation',
      body: 'needs a human',
      type: 'escalation',
      priority: 'urgent',
      thread_id: null,
      payload: null,
      read: 0,
      sequence: 5,
      created_at: '2026-05-30T10:33:00Z',
      delivered_at: null
    }
    const message = mapMessage(row)
    expect(message.type).toBe('escalation')
    expect(message.priority).toBe('urgent')
    expect(message.fromHandle).toBe('term_7c')
    expect(message.threadId).toBeUndefined()
  })
})

describe('mapAgentSnapshot', () => {
  const NOW = Date.parse('2026-05-30T10:35:00Z')
  const handleByPaneKey = new Map<string, OrcaTerminalSummary>([
    [
      'tab_12:leaf_a',
      {
        handle: 'term_4f',
        worktreeId: 'wt_ports',
        worktreePath: '/w/ports',
        branch: 'ports',
        tabId: 'tab_12',
        leafId: 'leaf_a',
        title: null,
        connected: true,
        writable: true,
        lastOutputAt: NOW,
        preview: '',
        note: ''
      }
    ]
  ])

  const ctx = (overrides: Partial<AgentMapContext> = {}): AgentMapContext => ({
    handleByPaneKey,
    coordinatorHandles: new Set(['term_coord']),
    taskTitleById: new Map([['task_cc06', 'Workspace-ports status line']]),
    now: NOW,
    ...overrides
  })

  const worker: AgentStatusEntry = {
    state: 'working',
    prompt: 'Add a workspace-ports status line',
    updatedAt: NOW - 60_000,
    stateStartedAt: NOW - 180_000,
    agentType: 'claude',
    paneKey: 'tab_12:leaf_a',
    stateHistory: [],
    toolName: 'Edit',
    toolInput: 'src/cli/handlers/status.ts',
    orchestration: {
      taskId: 'task_cc06',
      dispatchId: 'disp_01',
      coordinatorHandle: 'term_coord',
      parentTerminalHandle: 'term_coord',
      orchestrationRunId: 'run_7a3'
    }
  }

  it('resolves the human handle via paneKey and labels by dispatched task title', () => {
    const snapshot = mapAgentSnapshot(worker, ctx())
    expect(snapshot.handle).toBe('term_4f')
    expect(snapshot.label).toBe('Workspace-ports status line')
    expect(snapshot.worktreeId).toBe('wt_ports')
    expect(snapshot.worktreeName).toBe('wt_ports')
    expect(snapshot.taskId).toBe('task_cc06')
    expect(snapshot.isCoordinator).toBe(false)
  })

  it('falls back to the paneKey when no terminal handle is known', () => {
    const snapshot = mapAgentSnapshot(worker, ctx({ handleByPaneKey: new Map() }))
    expect(snapshot.handle).toBe('tab_12:leaf_a')
  })

  it('labels the coordinator distinctly', () => {
    const coord: AgentStatusEntry = {
      ...worker,
      paneKey: 'tab_0:leaf_c',
      orchestration: { ...worker.orchestration!, taskId: '', coordinatorHandle: 'term_coord' }
    }
    const handleMap = new Map(handleByPaneKey)
    handleMap.set('tab_0:leaf_c', {
      ...handleByPaneKey.get('tab_12:leaf_a')!,
      handle: 'term_coord',
      tabId: 'tab_0',
      leafId: 'leaf_c'
    })
    const snapshot = mapAgentSnapshot(coord, ctx({ handleByPaneKey: handleMap }))
    expect(snapshot.isCoordinator).toBe(true)
    expect(snapshot.label).toBe('Run coordinator')
  })

  it('decays to idle past the TTL', () => {
    const stale: AgentStatusEntry = { ...worker, updatedAt: NOW - 40 * 60 * 1000 }
    const snapshot = mapAgentSnapshot(stale, ctx())
    expect(snapshot.state).toBe('idle')
  })
})

describe('deriveCoordinatorState', () => {
  it('counts by status and infers running when dispatched > 0', () => {
    const tasks = [
      { status: 'dispatched' },
      { status: 'dispatched' },
      { status: 'completed' },
      { status: 'pending' }
    ] as Task[]
    const state = deriveCoordinatorState(tasks)
    expect(state.status).toBe('running')
    expect(state.activeDispatches).toBe(2)
    expect(state.counts.dispatched).toBe(2)
    expect(state.counts.completed).toBe(1)
  })

  it('is idle when nothing is dispatched', () => {
    const tasks = [{ status: 'completed' }, { status: 'pending' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('idle')
  })

  it('is completed when every task finished cleanly (none in flight, none failed)', () => {
    const tasks = [{ status: 'completed' }, { status: 'completed' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('completed')
  })

  it('is failed when work ended with an unresolved failure and nothing queued', () => {
    const tasks = [{ status: 'failed' }, { status: 'completed' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('failed')
  })

  it('stays running over a failed task while a dispatch is still in flight', () => {
    const tasks = [{ status: 'failed' }, { status: 'dispatched' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('running')
  })

  it('a failure with queued work to retry reads idle, not failed', () => {
    const tasks = [{ status: 'failed' }, { status: 'ready' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('idle')
  })

  it('a blocked task keeps the run idle, not completed', () => {
    const tasks = [{ status: 'completed' }, { status: 'blocked' }] as Task[]
    expect(deriveCoordinatorState(tasks).status).toBe('idle')
  })

  it('an empty board is idle with zeroed counts', () => {
    const state = deriveCoordinatorState([])
    expect(state.status).toBe('idle')
    expect(state.activeDispatches).toBe(0)
    expect(state.counts).toEqual({
      pending: 0,
      ready: 0,
      dispatched: 0,
      completed: 0,
      failed: 0,
      blocked: 0
    })
  })
})

describe('shortBranchName', () => {
  it('strips the refs/heads/ prefix', () => {
    expect(shortBranchName('refs/heads/main')).toBe('main')
    expect(shortBranchName('refs/heads/BorjaLL/matriarch-web-portal')).toBe(
      'BorjaLL/matriarch-web-portal'
    )
  })
  it('leaves an already-short branch intact and trims whitespace', () => {
    expect(shortBranchName('feature/x')).toBe('feature/x')
    expect(shortBranchName('  main  ')).toBe('main')
  })
  it('returns undefined for empty/whitespace/missing input', () => {
    expect(shortBranchName(undefined)).toBeUndefined()
    expect(shortBranchName('')).toBeUndefined()
    expect(shortBranchName('   ')).toBeUndefined()
    expect(shortBranchName('refs/heads/')).toBeUndefined()
  })
})

describe('deriveTaskHistory', () => {
  it('includes dispatched + completed rows for a completed task', () => {
    const history = deriveTaskHistory({
      id: 't',
      title: 't',
      spec: 't',
      status: 'completed',
      deps: [],
      assigneeHandle: 'term_ec66',
      completedAt: '09:52'
    } as Task)
    expect(history.map((h) => h.status)).toEqual(['ready', 'dispatched-to', 'completed'])
  })

  it('marks a blocked task as blocked on gate', () => {
    const history = deriveTaskHistory({
      id: 't',
      title: 't',
      spec: 't',
      status: 'blocked',
      deps: []
    } as Task)
    expect(history.at(-1)?.label).toBe('blocked on gate')
  })
})

describe('deriveWorktreeName', () => {
  it('takes the folder leaf from an <id>::<path> composite', () => {
    expect(deriveWorktreeName('77cb282f::/Users/b/orca/workspaces/orca/matriarch-web-portal')).toBe(
      'matriarch-web-portal'
    )
  })
  it('handles a bare path with a trailing slash', () => {
    expect(deriveWorktreeName('/Users/b/Projects/work/scrum-team-1/')).toBe('scrum-team-1')
  })
  it('returns the value when there is no path separator', () => {
    expect(deriveWorktreeName('wt_ports')).toBe('wt_ports')
  })
  it('returns undefined for empty input', () => {
    expect(deriveWorktreeName(undefined)).toBeUndefined()
    expect(deriveWorktreeName('')).toBeUndefined()
  })
})

describe('mapTerminalSummary', () => {
  const base: OrcaTerminalSummary = {
    handle: 'term_4f',
    worktreeId: '77cb::/Users/b/orca/workspaces/orca/matriarch-web-portal',
    worktreePath: '/Users/b/orca/workspaces/orca/matriarch-web-portal',
    branch: 'BorjaLL/matriarch',
    tabId: 'tab_12',
    leafId: 'leaf_a',
    title: 'matriarch',
    connected: true,
    writable: true,
    lastOutputAt: 1000,
    preview: '  $ git status  ',
    note: '  reworking the board  '
  }

  it('projects the wire row to a portal TerminalSummary', () => {
    const t = mapTerminalSummary(base)
    expect(t.handle).toBe('term_4f')
    expect(t.paneKey).toBe('tab_12:leaf_a')
    expect(t.worktreeName).toBe('matriarch-web-portal')
    expect(t.branch).toBe('BorjaLL/matriarch')
    expect(t.connected).toBe(true)
    expect(t.lastOutputAt).toBe(1000)
    expect(t.preview).toBe('$ git status')
    expect(t.note).toBe('reworking the board')
    // Defaults to false when the runtime omits it; passes through when present.
    expect(t.hasRunningProcess).toBe(false)
    expect(mapTerminalSummary({ ...base, hasRunningProcess: true }).hasRunningProcess).toBe(true)
    expect(mapTerminalSummary({ ...base, branch: 'refs/heads/main' }).branch).toBe('main')
  })

  it('drops empty preview/branch/title/note to undefined and handles a Windows path', () => {
    const t = mapTerminalSummary({
      ...base,
      worktreeId: 'C:\\repos\\homelab',
      branch: '',
      title: null,
      preview: '   ',
      note: '   '
    })
    expect(t.worktreeName).toBe('homelab')
    expect(t.branch).toBeUndefined()
    expect(t.title).toBeUndefined()
    expect(t.preview).toBeUndefined()
    expect(t.note).toBeUndefined()
  })
})

describe('collectCoordinatorHandles', () => {
  it('gathers coordinator handles referenced by any entry', () => {
    const entries = [
      { orchestration: { coordinatorHandle: 'term_coord' } },
      { orchestration: { coordinatorHandle: 'term_coord' } },
      { orchestration: {} },
      {}
    ] as AgentStatusEntry[]
    expect([...collectCoordinatorHandles(entries)]).toEqual(['term_coord'])
  })
})
