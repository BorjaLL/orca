// The unified Board is TERMINAL-FIRST: one card per terminal/pane, with the agent
// running there and the task it's on folded onto that card as labels (no separate
// agent/task cards in the common case). Robustness rules so nothing important is
// lost: a live agent with no terminal row still gets a card (it's a real pane),
// and tasks with no pane appear when actionable (todo / in-flight / needs-you).
// Completed work whose pane is gone is intentionally dropped so finished items
// don't pile up in Review & ship. Pure (clock passed in via `now`) so it's
// directly unit-testable.

import { SquareTerminal } from 'lucide-react'
import type { AgentSnapshot, Task, TerminalSummary } from '../backend'
import {
  AGENT_STATE_CONFIG,
  TASK_STATUS_CONFIG,
  WORK_COLUMN_CONFIG,
  type StatusConfig,
  type WorkColumn
} from '../components/status-vocabulary'

export type WorkItemKind = 'terminal' | 'agent' | 'task'

/** The branch/worktree chip on a card; opens the agent when agent-backed. */
export type WorkItemChip = {
  handle: string
  worktreeName?: string
  branch?: string
  /** True when a live AgentSnapshot backs this handle (chip → open agent). */
  agentBacked: boolean
}

export type WorkItem = {
  /** Stable, kind-prefixed React key + selection id. */
  id: string
  kind: WorkItemKind
  column: WorkColumn
  /** Resolved icon/tone/spin for the header glyph — derived once alongside the
   *  column so the card stays consistent (live spin only for genuine activity). */
  config: StatusConfig
  /** Lead identity — the terminal's worktree/title. */
  title: string
  /** Durable "what I'm working on" note: the explicit terminal note, else the task title. */
  note: string
  /** Live activity line: the agent's current tool/message (or terminal preview / task result). */
  summary: string
  /** ms epoch for the relative-time label + recency decay; null when unknown. */
  timestamp: number | null
  chip?: WorkItemChip
  task?: Task
  agent?: AgentSnapshot
  terminal?: TerminalSummary
}

/**
 * Done/completed work older than this decays out of Review & ship into Parked, so
 * finished items stop clogging the column (the reported "wrong column" bug).
 */
export const REVIEW_SHIP_RECENCY_MS = 60 * 60 * 1000

/**
 * Merge terminals + agents + tasks into one terminal-first card list.
 * Pass A emits one card per terminal (agent + task folded in). Pass B keeps live
 * agents that have no terminal row (still real panes). Pass C surfaces tasks with
 * no pane, but only the actionable ones — completed orphans are dropped.
 */
export function buildWorkItems(
  tasks: Task[],
  agents: AgentSnapshot[],
  terminals: TerminalSummary[],
  now: number
): WorkItem[] {
  const agentByHandle = new Map(agents.map((a) => [a.handle, a]))
  const agentByPaneKey = new Map(agents.map((a) => [a.paneKey, a]))
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const taskByAssignee = new Map<string, Task>()
  for (const t of tasks) {
    if (t.assigneeHandle) {
      taskByAssignee.set(t.assigneeHandle, t)
    }
  }

  const consumedAgents = new Set<string>()
  const consumedTasks = new Set<string>()
  const items: WorkItem[] = []

  // Pass A — one card per terminal (the spine of the board).
  for (const term of terminals) {
    const agent = agentByHandle.get(term.handle) ?? agentByPaneKey.get(term.paneKey)
    if (agent) {
      consumedAgents.add(agent.handle)
    }
    const task = resolveTask(agent, term.handle, taskById, taskByAssignee)
    if (task) {
      consumedTasks.add(task.id)
    }
    items.push(makeTerminalItem(term, agent, task, now))
  }

  // Pass B — live agents with no terminal row are still real panes; never drop them.
  for (const agent of agents) {
    if (consumedAgents.has(agent.handle)) {
      continue
    }
    const task = resolveTask(agent, agent.handle, taskById, taskByAssignee)
    if (task) {
      consumedTasks.add(task.id)
    }
    items.push(makeAgentItem(agent, task, now))
  }

  // Pass C — tasks with no pane. Keep the actionable backlog (todo / in-flight /
  // needs-you); drop completed ones whose pane is gone so Review & ship stays current.
  for (const task of tasks) {
    if (consumedTasks.has(task.id) || task.status === 'completed') {
      continue
    }
    items.push(makeTaskItem(task, now))
  }

  return items
}

function resolveTask(
  agent: AgentSnapshot | undefined,
  handle: string,
  taskById: Map<string, Task>,
  taskByAssignee: Map<string, Task>
): Task | undefined {
  return (agent?.taskId ? taskById.get(agent.taskId) : undefined) ?? taskByAssignee.get(handle)
}

/** Extra signals for column placement that aren't on the agent/task themselves. */
export type ColumnContext = {
  /** A live foreground process (≠ shell) is running in the pane (terminal.list). */
  busy?: boolean
  /** A live pane (terminal or agent) backs this item — false for task-only cards. */
  hasLivePane?: boolean
}

/**
 * Terminal-first column placement. The live **agent state wins the attention
 * split** (a blocked/waiting agent means a human is needed now); otherwise task
 * status drives; a plain terminal parks. A pane running a foreground process is
 * **working** even if its agent reported done (a finished agent can leave a
 * command running). A dispatched task with no live pane is an orphaned dispatch:
 * working only briefly (the pane may be spawning), else it needs a human.
 * Done/completed work decays to Parked once it ages past the recency window.
 */
export function deriveColumn(
  agent: AgentSnapshot | undefined,
  task: Task | undefined,
  timestamp: number | null,
  now: number,
  ctx: ColumnContext = {}
): WorkColumn {
  const { busy = false, hasLivePane = false } = ctx
  const recent = timestamp !== null && now - timestamp <= REVIEW_SHIP_RECENCY_MS
  if (agent) {
    switch (agent.state) {
      case 'blocked':
      case 'waiting':
        return 'needs-you'
      case 'done':
        if (busy) {
          return 'working' // agent finished but left a process running
        }
        return recent ? 'review-ship' : 'parked'
      case 'working':
        return isTaskAttention(task) ? 'needs-you' : 'working'
      case 'idle':
        if (isTaskAttention(task)) {
          return 'needs-you'
        }
        if (busy) {
          return 'working'
        }
        if (task?.status === 'completed') {
          return recent ? 'review-ship' : 'parked'
        }
        if (task) {
          return 'working' // dispatched but the agent went quiet — still in flight
        }
        return 'parked'
    }
  }
  if (task) {
    switch (task.status) {
      case 'pending':
      case 'ready':
        return 'todo'
      case 'dispatched':
        // A live pane (or running process) backs it → working. Otherwise it's an
        // orphaned dispatch: keep "working" only while fresh, else it needs a human.
        if (hasLivePane || busy) {
          return 'working'
        }
        return recent ? 'working' : 'needs-you'
      case 'blocked':
      case 'failed':
        return 'needs-you'
      case 'completed':
        return recent ? 'review-ship' : 'parked'
    }
  }
  return busy ? 'working' : 'parked'
}

function isTaskAttention(task: Task | undefined): boolean {
  return task?.status === 'blocked' || task?.status === 'failed'
}

/** Plain-shell fallback glyph (no agent, no task). */
const TERMINAL_CONFIG: StatusConfig = { icon: SquareTerminal, tone: 'muted', label: 'terminal' }

/**
 * The card's header glyph, consistent with the column. A genuinely active pane
 * (working agent, or any pane with a running process) shows the live working
 * spinner; an orphaned dispatch parked in Needs you shows the amber attention
 * glyph, not the live "dispatched" spinner. Otherwise it mirrors the agent state,
 * else the task status, else a plain terminal.
 */
export function deriveDisplayConfig(
  agent: AgentSnapshot | undefined,
  task: Task | undefined,
  column: WorkColumn,
  ctx: ColumnContext = {}
): StatusConfig {
  const busy = ctx.busy ?? false
  const agentNeedsHuman = agent?.state === 'blocked' || agent?.state === 'waiting'
  // A running foreground process reads as "working" unless a human is needed.
  if (busy && !agentNeedsHuman && !isTaskAttention(task)) {
    return WORK_COLUMN_CONFIG.working
  }
  if (agent) {
    return AGENT_STATE_CONFIG[agent.state]
  }
  if (task) {
    // Orphaned dispatch that fell into Needs you: don't imply live activity.
    if (task.status === 'dispatched' && column === 'needs-you') {
      return WORK_COLUMN_CONFIG['needs-you']
    }
    return TASK_STATUS_CONFIG[task.status]
  }
  return TERMINAL_CONFIG
}

function makeTerminalItem(
  term: TerminalSummary,
  agent: AgentSnapshot | undefined,
  task: Task | undefined,
  now: number
): WorkItem {
  const timestamp = agent?.stateStartedAt ?? term.lastOutputAt
  const ctx: ColumnContext = { busy: term.hasRunningProcess ?? false, hasLivePane: true }
  const column = deriveColumn(agent, task, timestamp, now, ctx)
  return {
    id: `terminal:${term.paneKey}`,
    kind: 'terminal',
    column,
    config: deriveDisplayConfig(agent, task, column, ctx),
    title: term.worktreeName ?? term.title ?? agent?.worktreeName ?? task?.title ?? term.handle,
    note: effectiveNote(term.note, task),
    summary: activityLine(agent, task, term),
    timestamp,
    chip: {
      handle: term.handle,
      worktreeName: term.worktreeName ?? agent?.worktreeName,
      branch: term.branch,
      agentBacked: Boolean(agent)
    },
    task,
    agent,
    terminal: term
  }
}

function makeAgentItem(agent: AgentSnapshot, task: Task | undefined, now: number): WorkItem {
  const ctx: ColumnContext = { hasLivePane: true }
  const column = deriveColumn(agent, task, agent.stateStartedAt, now, ctx)
  return {
    id: `agent:${agent.paneKey}`,
    kind: 'agent',
    column,
    config: deriveDisplayConfig(agent, task, column, ctx),
    title: agent.worktreeName ?? task?.title ?? agent.label,
    note: effectiveNote(undefined, task),
    summary: activityLine(agent, task, undefined),
    timestamp: agent.stateStartedAt,
    chip: {
      handle: agent.handle,
      worktreeName: agent.worktreeName,
      agentBacked: true
    },
    task,
    agent
  }
}

function makeTaskItem(task: Task, now: number): WorkItem {
  const timestamp = taskTimestamp(task)
  // hasLivePane defaults false: a task-only card has no terminal/agent backing it.
  const column = deriveColumn(undefined, task, timestamp, now)
  return {
    id: `task:${task.id}`,
    kind: 'task',
    column,
    config: deriveDisplayConfig(undefined, task, column),
    title: task.title,
    note: '',
    summary: task.result ?? '',
    timestamp,
    task
  }
}

/** Durable note: the agent-set terminal note, else fall back to the task title. */
function effectiveNote(note: string | undefined, task: Task | undefined): string {
  return (note && note.trim()) || task?.title || ''
}

/** Live activity: the agent's current tool/message (else terminal preview), prefixed
 *  with the task id when a task is attached so the card still names the dispatch. */
function activityLine(
  agent: AgentSnapshot | undefined,
  task: Task | undefined,
  term: TerminalSummary | undefined
): string {
  const activity = agent ? agentActivity(agent) : (term?.preview ?? '')
  if (task?.id && activity) {
    return `${task.id} · ${activity}`
  }
  return activity || task?.id || ''
}

function agentActivity(agent: AgentSnapshot): string {
  if (agent.toolName) {
    return agent.toolInput ? `${agent.toolName} · ${agent.toolInput}` : agent.toolName
  }
  return agent.lastAssistantMessage ?? agent.prompt ?? ''
}

function taskTimestamp(task: Task): number | null {
  const raw = task.completedAt ?? task.startedAt ?? task.createdAt
  if (!raw) {
    return null
  }
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}
