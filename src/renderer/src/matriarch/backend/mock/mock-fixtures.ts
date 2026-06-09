/* oxlint-disable max-lines -- Why: a single cross-linked design fixture (tasks +
   agents + gates + messages for the run_7a3 scenario) read as one unit; splitting
   it would scatter the cross-references that make every UI link resolve. */
// The run_7a3 scenario - "Ship 4 small Orca PRs" - mirrored from the design
// pack's mock data (matriarch-portal-mock-data.md / the prototype's data.jsx).
// Cross-linked tasks ↔ agents ↔ gates ↔ messages so every UI link resolves.
// Fleet is all-claude here, so the agent-type chip auto-hides (homogeneous).

import type {
  AgentSnapshot,
  CoordinatorState,
  Gate,
  Message,
  Task,
  TaskStatus,
  TerminalSummary
} from '../matriarch-types'

/** A fixed clock for deterministic relative times (run_7a3 is "now" ≈ 10:35). */
export const MOCK_NOW = Date.parse('2026-05-30T10:35:00Z')

const min = (n: number): number => n * 60_000

export const MOCK_RUN = {
  runId: 'run_7a3',
  spec: 'Ship 4 small Orca PRs',
  status: 'running' as const,
  coordinatorHandle: 'term_coord',
  pollIntervalMs: 2000,
  maxConcurrent: 4
}

export const MOCK_TASKS: Task[] = [
  {
    id: 'task_89b2',
    title: 'CLI --workspace-status flag',
    spec: 'Add a --workspace-status flag to `orca worktree set` (CLI passthrough). Update help + a CLI test mirroring --comment.',
    status: 'completed',
    deps: [],
    result: 'PR #3741 (draft) opened',
    assigneeHandle: 'term_ec66',
    completedAt: '09:52'
  },
  {
    id: 'task_dd10',
    title: 'Inline worktree comment on cards',
    spec: 'Render the worktree comment inline on the sidebar card face (truncated), gated on non-empty.',
    status: 'completed',
    deps: [],
    result: 'PR #3742 (draft) opened',
    assigneeHandle: 'term_dd10w',
    completedAt: '10:10'
  },
  {
    id: 'task_dd11',
    title: 'Relay rg search timeout fix',
    spec: 'Settle relay rg search timeouts: thread an AbortSignal through the relay grep path.',
    status: 'completed',
    deps: [],
    result: 'PR #3734 merged',
    assigneeHandle: 'term_dd11w',
    completedAt: '10:41'
  },
  {
    id: 'task_dd12',
    title: 'Quick-workspace fallback test',
    spec: 'Update quick-workspace agent fallback order test.',
    status: 'completed',
    deps: [],
    result: 'PR #3735 merged',
    assigneeHandle: 'term_dd12w',
    completedAt: '10:55'
  },
  {
    id: 'task_cc06',
    title: 'Workspace-ports status line',
    spec: 'Add a workspace-ports status line to `orca status --json` (ports the workspace exposes).',
    status: 'dispatched',
    deps: [],
    assigneeHandle: 'term_4f',
    startedAt: '10:31'
  },
  {
    id: 'task_cc07',
    title: 'GitLab resolveDiscussion parity',
    spec: 'Provider-agnostic: add gitlab.resolveDiscussion to mirror github.resolveReviewThread.',
    status: 'dispatched',
    deps: [],
    assigneeHandle: 'term_9a',
    startedAt: '10:33'
  },
  // Orphaned dispatch: marked dispatched but its assignee pane is gone (no agent,
  // no terminal). Surfaces in Needs you, not Working — the "hand to matriarch" case.
  {
    id: 'task_or15',
    title: 'Visually verify the board columns',
    spec: 'Manually verify the unified board column placement after the fit-to-columns change.',
    status: 'dispatched',
    deps: [],
    assigneeHandle: 'term_gone',
    startedAt: '09:30'
  },
  {
    id: 'task_bb04',
    title: 'Mobile companion agentStatus',
    spec: 'Web: surface session.tabs.subscribeAll agentStatus in the mobile companion list.',
    status: 'ready',
    deps: []
  },
  {
    id: 'task_bb05',
    title: 'Doc: web client pairing flow',
    spec: 'Docs: document the runtime-scope webClientUrl pairing flow.',
    status: 'ready',
    deps: []
  },
  {
    id: 'task_aa01',
    title: 'orchestration.subscribe method',
    spec: 'Add an orchestration.subscribe streaming method + onOrchestrationChanged emitter.',
    status: 'pending',
    deps: ['task_cc06']
  },
  {
    id: 'task_aa02',
    title: 'Register subscribe channel',
    spec: 'Register orchestration.subscribe in SHARED_CONNECTION_SUBSCRIPTION_METHODS.',
    status: 'pending',
    deps: ['task_aa01']
  },
  {
    id: 'task_aa03',
    title: 'E2E live-push test',
    spec: 'E2E: pair a browser as runtime scope and assert a live orchestration push.',
    status: 'pending',
    deps: ['task_aa01', 'task_aa02']
  },
  {
    id: 'task_ee13',
    title: 'Local rg search timeout fix',
    spec: 'Flaky: settle local rg search timeouts under SSH latency.',
    status: 'failed',
    deps: [],
    result: 'circuit-broken after 3 attempts: persistent test timeout',
    attempts: '3/3',
    assigneeHandle: 'term_7c',
    completedAt: '10:33'
  },
  {
    id: 'task_ff14',
    title: 'Repo-badge color cache',
    spec: 'Add a persistence cache for repo-badge colors (choose a backing store).',
    status: 'blocked',
    deps: [],
    assigneeHandle: 'term_3b'
  }
]

export const MOCK_AGENTS: AgentSnapshot[] = [
  {
    handle: 'term_coord',
    paneKey: 'tab_0:leaf_c',
    label: 'Run coordinator',
    state: 'working',
    agentType: 'claude',
    isCoordinator: true,
    prompt: 'Coordinator: ship 4 small Orca PRs (run_7a3)',
    toolName: 'orchestration.dispatch',
    toolInput: 'task_cc07 --to term_9a',
    lastAssistantMessage: 'Dispatched task_cc07; 2 ready, 3 pending, 1 blocked on a gate.',
    stateStartedAt: MOCK_NOW - min(0.2),
    updatedAt: MOCK_NOW,
    runId: 'run_7a3',
    worktreeId: 'wt_main',
    worktreeName: 'orca'
  },
  {
    handle: 'term_4f',
    paneKey: 'tab_12:leaf_a',
    label: 'Workspace-ports status line',
    state: 'working',
    agentType: 'claude',
    isCoordinator: false,
    prompt: 'Add a workspace-ports status line to orca status --json',
    toolName: 'Edit',
    toolInput: 'src/cli/handlers/status.ts',
    lastAssistantMessage: 'Wiring the ports field into the status payload…',
    stateStartedAt: MOCK_NOW - min(3),
    updatedAt: MOCK_NOW - min(0.2),
    taskId: 'task_cc06',
    dispatchId: 'disp_01',
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3',
    worktreeId: 'wt_ports',
    worktreeName: 'workspace-ports'
  },
  {
    handle: 'term_9a',
    paneKey: 'tab_13:leaf_a',
    label: 'GitLab resolveDiscussion parity',
    state: 'working',
    agentType: 'claude',
    isCoordinator: false,
    prompt: 'Add gitlab.resolveDiscussion to mirror github.resolveReviewThread',
    toolName: 'Bash',
    toolInput: 'rg -n resolveReviewThread src/main/runtime/rpc/methods',
    lastAssistantMessage: 'Scanning the GitHub method for the shape to mirror…',
    stateStartedAt: MOCK_NOW - min(2),
    updatedAt: MOCK_NOW - min(0.1),
    taskId: 'task_cc07',
    dispatchId: 'disp_02',
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3',
    worktreeId: 'wt_gitlab',
    worktreeName: 'gitlab-parity'
  },
  {
    handle: 'term_3b',
    paneKey: 'tab_14:leaf_a',
    label: 'Repo-badge color cache',
    state: 'waiting',
    agentType: 'claude',
    isCoordinator: false,
    prompt: 'Add a persistence cache for repo-badge colors',
    lastAssistantMessage: 'Blocked on a decision: which backing store for the cache?',
    stateStartedAt: MOCK_NOW - min(13),
    updatedAt: MOCK_NOW - min(13),
    taskId: 'task_ff14',
    dispatchId: 'disp_03',
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3'
  },
  {
    handle: 'term_7c',
    paneKey: 'tab_15:leaf_a',
    label: 'Local rg search timeout fix',
    state: 'blocked',
    agentType: 'claude',
    isCoordinator: false,
    prompt: 'Settle local rg search timeouts under SSH latency',
    lastAssistantMessage:
      'Escalating: the test times out even after the AbortSignal fix; needs a human.',
    stateStartedAt: MOCK_NOW - min(4),
    updatedAt: MOCK_NOW - min(4),
    taskId: 'task_ee13',
    dispatchId: 'disp_04',
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3',
    worktreeId: 'wt_rg',
    worktreeName: 'rg-timeouts'
  },
  {
    handle: 'term_ec66',
    paneKey: 'tab_8:leaf_a',
    label: 'CLI --workspace-status flag',
    state: 'done',
    agentType: 'claude',
    isCoordinator: false,
    prompt: 'Add a --workspace-status flag to orca worktree set',
    lastAssistantMessage: 'Done — opened draft PR #3741. Reported back to the coordinator.',
    stateStartedAt: MOCK_NOW - min(42),
    updatedAt: MOCK_NOW - min(42),
    taskId: 'task_89b2',
    dispatchId: 'disp_00',
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3',
    worktreeId: 'wt_cli',
    worktreeName: 'cli-workspace-status'
  },
  {
    handle: 'term_2d',
    paneKey: 'tab_7:leaf_b',
    label: 'Idle worker',
    state: 'idle',
    agentType: 'claude',
    isCoordinator: false,
    prompt: '(previous task complete — terminal idle)',
    lastAssistantMessage: 'Idle since 10:05.',
    stateStartedAt: MOCK_NOW - min(30),
    updatedAt: MOCK_NOW - min(30),
    parentHandle: 'term_coord',
    parentPaneKey: 'tab_0:leaf_c',
    coordinatorHandle: 'term_coord',
    runId: 'run_7a3'
  }
]

// terminal.list mirror. The first group backs the agents above (same handle/
// paneKey) so the unified Board MERGES them and never double-shows them as plain
// shells; the second group are genuine shells (no agent, no task) → Parked.
export const MOCK_TERMINALS: TerminalSummary[] = [
  {
    handle: 'term_coord',
    paneKey: 'tab_0:leaf_c',
    worktreeName: 'orca',
    branch: 'main',
    title: 'coordinator',
    connected: true,
    lastOutputAt: MOCK_NOW - min(0.1),
    preview: 'orchestration.dispatch task_cc07 --to term_9a',
    note: 'coordinating the run: 4 PRs, 1 blocked on a gate'
  },
  {
    handle: 'term_4f',
    paneKey: 'tab_12:leaf_a',
    worktreeName: 'workspace-ports',
    branch: 'BorjaLL/workspace-ports',
    connected: true,
    lastOutputAt: MOCK_NOW - min(0.2),
    preview: 'Wiring the ports field into the status payload',
    note: 'adding the ports field to orca status --json'
  },
  {
    handle: 'term_9a',
    paneKey: 'tab_13:leaf_a',
    worktreeName: 'gitlab-parity',
    branch: 'BorjaLL/gitlab-parity',
    connected: true,
    lastOutputAt: MOCK_NOW - min(0.1)
  },
  {
    handle: 'term_7c',
    paneKey: 'tab_15:leaf_a',
    worktreeName: 'rg-timeouts',
    branch: 'BorjaLL/rg-timeouts',
    connected: true,
    lastOutputAt: MOCK_NOW - min(4),
    note: 'escalated: rg test still times out after the fix'
  },
  {
    handle: 'term_ec66',
    paneKey: 'tab_8:leaf_a',
    worktreeName: 'cli-workspace-status',
    branch: 'BorjaLL/cli-workspace-status',
    connected: true,
    lastOutputAt: MOCK_NOW - min(42)
  },
  {
    handle: 'term_shell1',
    paneKey: 'tab_20:leaf_a',
    worktreeName: 'orca',
    branch: 'main',
    title: 'zsh',
    connected: true,
    lastOutputAt: MOCK_NOW - min(8),
    preview: '$ git status'
  },
  {
    handle: 'term_build',
    paneKey: 'tab_21:leaf_a',
    worktreeName: 'scrum-team-1',
    branch: 'main',
    title: 'pnpm dev',
    connected: true,
    lastOutputAt: MOCK_NOW - min(1),
    preview: 'VITE v7.3.2 ready in 812 ms',
    hasRunningProcess: true
  },
  {
    handle: 'term_ssh',
    paneKey: 'tab_22:leaf_a',
    title: 'homelab',
    connected: true,
    lastOutputAt: MOCK_NOW - min(20),
    preview: 'borja@homelab:~$'
  }
]

export const MOCK_GATES: Gate[] = [
  {
    id: 'gate_01',
    taskId: 'task_ff14',
    question: 'Which backing store for the repo-badge color cache?',
    options: ['SQLite (existing dep)', 'In-memory + JSON flush', 'Ask me'],
    status: 'pending',
    toHandle: 'term_3b',
    createdAt: '10:21'
  },
  {
    id: 'gate_00',
    taskId: 'task_dd11',
    question: 'Abort on first timeout or retry once?',
    options: ['Abort', 'Retry once'],
    status: 'resolved',
    resolution: 'Abort',
    toHandle: 'term_coord',
    createdAt: '10:30'
  }
]

export const MOCK_MESSAGES: Message[] = [
  {
    id: 'msg_08',
    fromHandle: 'term_4f',
    toHandle: 'term_coord',
    type: 'heartbeat',
    priority: 'normal',
    body: 'still working — editing src/cli/handlers/status.ts',
    createdAt: '10:34',
    sequence: 8
  },
  {
    id: 'msg_07',
    fromHandle: 'term_coord',
    toHandle: 'term_9a',
    type: 'status',
    priority: 'normal',
    body: 'Heads up: task_cc07 depends on the gitlab.ts method shape; mirror github.ts:411.',
    createdAt: '10:34',
    sequence: 7
  },
  {
    id: 'msg_06',
    fromHandle: 'term_dd11w',
    toHandle: 'term_coord',
    type: 'merge_ready',
    priority: 'normal',
    body: 'PR #3734 approved & green — ready to merge.',
    createdAt: '10:40',
    sequence: 6
  },
  {
    id: 'msg_05',
    fromHandle: 'term_7c',
    toHandle: 'term_coord',
    type: 'escalation',
    priority: 'urgent',
    body: 'task_ee13 still times out after the AbortSignal fix — circuit-broke at 3/3. Needs a human.',
    createdAt: '10:33',
    sequence: 5
  },
  {
    id: 'msg_04',
    fromHandle: 'term_3b',
    toHandle: 'term_coord',
    type: 'decision_gate',
    priority: 'high',
    body: 'Which backing store for the badge-color cache? (SQLite / in-memory / ask)',
    createdAt: '10:21',
    sequence: 4
  },
  {
    id: 'msg_03',
    fromHandle: 'term_coord',
    toHandle: 'term_4f',
    type: 'dispatch',
    priority: 'normal',
    body: 'Dispatch: task_cc06 — workspace-ports status line.',
    createdAt: '10:12',
    sequence: 3
  },
  {
    id: 'msg_02',
    fromHandle: 'term_ec66',
    toHandle: 'term_coord',
    type: 'worker_done',
    priority: 'normal',
    body: 'Done — draft PR #3741 opened. Tests green.',
    createdAt: '09:52',
    sequence: 2
  },
  {
    id: 'msg_01',
    fromHandle: 'term_coord',
    toHandle: 'term_ec66',
    type: 'dispatch',
    priority: 'normal',
    body: 'Dispatch: task_89b2 — CLI --workspace-status flag.',
    createdAt: '09:11',
    sequence: 1
  }
]

/** Derive the coordinator summary from the fixture tasks (same logic the Orca adapter uses). */
export function deriveMockCoordinator(tasks: Task[]): CoordinatorState {
  const counts = {
    pending: 0,
    ready: 0,
    dispatched: 0,
    completed: 0,
    failed: 0,
    blocked: 0
  } as Record<TaskStatus, number>
  for (const t of tasks) {
    counts[t.status] += 1
  }
  return {
    status: 'running',
    handle: MOCK_RUN.coordinatorHandle,
    runId: MOCK_RUN.runId,
    spec: MOCK_RUN.spec,
    pollIntervalMs: MOCK_RUN.pollIntervalMs,
    counts,
    activeDispatches: counts.dispatched
  }
}
