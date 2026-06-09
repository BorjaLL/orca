// Pure mappers: Orca runtime wire rows → portal-facing domain types. Kept free
// of any client/IO so they're directly unit-testable (PRD §4.6 "adapter
// mappings"). The adapter (orca-backend.ts) is the only caller.

import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type {
  AgentSnapshot,
  CoordinatorRunStatus,
  CoordinatorState,
  Gate,
  Message,
  Task,
  TaskDetail,
  TaskStatus,
  TerminalSummary
} from '../matriarch-types'
import { deriveTaskTitle } from './derive-title'
import {
  type OrcaGateRow,
  type OrcaMessageRow,
  type OrcaTaskRow,
  type OrcaTerminalSummary,
  toAgentState
} from './orca-wire-types'

/** Agents quiet longer than this decay to `idle` (mirrors the desktop TTL). */
export const AGENT_IDLE_AFTER_MS = 30 * 60 * 1000

export function mapTask(row: OrcaTaskRow): Task {
  return {
    id: row.id,
    title: deriveTaskTitle(row.spec),
    spec: row.spec,
    status: row.status,
    parentId: row.parent_id ?? undefined,
    deps: parseStringArray(row.deps),
    result: row.result ?? undefined,
    assigneeHandle: row.assignee_handle ?? undefined,
    dispatchId: row.dispatch_id ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  }
}

export function mapGate(row: OrcaGateRow): Gate {
  return {
    id: row.id,
    taskId: row.task_id,
    question: row.question,
    options: parseStringArray(row.options),
    status: row.status,
    resolution: row.resolution ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined
  }
}

export function mapMessage(row: OrcaMessageRow): Message {
  return {
    id: row.id,
    fromHandle: row.from_handle,
    toHandle: row.to_handle,
    type: row.type,
    priority: row.priority,
    body: row.body,
    subject: row.subject,
    threadId: row.thread_id ?? undefined,
    sequence: row.sequence,
    createdAt: row.created_at
  }
}

export type AgentMapContext = {
  /** paneKey → terminal summary, for resolving the human handle + worktree. */
  handleByPaneKey: Map<string, OrcaTerminalSummary>
  /** Handles that are coordinators (referenced by any agent's context). */
  coordinatorHandles: Set<string>
  /** taskId → derived title, so an agent's label is its dispatched task's title. */
  taskTitleById: Map<string, string>
  /** Current wall clock for TTL decay. */
  now: number
}

export function mapAgentSnapshot(entry: AgentStatusEntry, ctx: AgentMapContext): AgentSnapshot {
  const term = ctx.handleByPaneKey.get(entry.paneKey)
  const handle = term?.handle ?? entry.paneKey
  const taskId = entry.orchestration?.taskId ?? undefined
  const isCoordinator = ctx.coordinatorHandles.has(handle)
  const decayed = ctx.now - entry.updatedAt > AGENT_IDLE_AFTER_MS
  const state = decayed ? 'idle' : toAgentState(entry.state)
  // Cards lead with a human NAME: the coordinator label, else the dispatched
  // task's title, else a title derived from the prompt, else the raw handle.
  const label = isCoordinator
    ? 'Run coordinator'
    : (taskId && ctx.taskTitleById.get(taskId)) ||
      (entry.prompt ? deriveTaskTitle(entry.prompt) : handle)
  return {
    handle,
    paneKey: entry.paneKey,
    label,
    state,
    agentType: entry.agentType,
    prompt: entry.prompt ?? '',
    toolName: entry.toolName,
    toolInput: entry.toolInput,
    lastAssistantMessage: entry.lastAssistantMessage,
    stateStartedAt: entry.stateStartedAt,
    updatedAt: entry.updatedAt,
    isCoordinator,
    taskId,
    dispatchId: entry.orchestration?.dispatchId ?? undefined,
    parentHandle: entry.orchestration?.parentTerminalHandle,
    parentPaneKey: entry.orchestration?.parentPaneKey,
    coordinatorHandle: entry.orchestration?.coordinatorHandle,
    runId: entry.orchestration?.orchestrationRunId,
    worktreeId: term?.worktreeId,
    worktreeName: deriveWorktreeName(term?.worktreeId)
  }
}

/** Human worktree name from Orca's `<id>::<path>` composite (or a bare path):
 *  `77cb…::/Users/me/orca/workspaces/orca/matriarch-web-portal` → `matriarch-web-portal`. */
export function deriveWorktreeName(worktreeId: string | undefined): string | undefined {
  if (!worktreeId) {
    return undefined
  }
  const path = worktreeId.includes('::')
    ? worktreeId.slice(worktreeId.lastIndexOf('::') + 2)
    : worktreeId
  const leaf = path.split(/[/\\]/).filter(Boolean).pop()
  return leaf && leaf.length > 0 ? leaf : undefined
}

/** Strip the `refs/heads/` prefix the runtime reports so cards show `main`, not
 *  `refs/heads/main` (the card chip then prefixes the worktree → `scrum-team-1/main`). */
export function shortBranchName(branch: string | undefined): string | undefined {
  if (!branch) {
    return undefined
  }
  const short = branch.replace(/^refs\/heads\//, '').trim()
  return short.length > 0 ? short : undefined
}

/** terminal.list row → portal-facing TerminalSummary (all terminals, incl. plain shells). */
export function mapTerminalSummary(row: OrcaTerminalSummary): TerminalSummary {
  return {
    handle: row.handle,
    paneKey: `${row.tabId}:${row.leafId}`,
    worktreeName: deriveWorktreeName(row.worktreeId),
    branch: shortBranchName(row.branch),
    title: row.title ?? undefined,
    connected: row.connected,
    lastOutputAt: row.lastOutputAt,
    preview: row.preview?.trim() || undefined,
    note: row.note?.trim() || undefined,
    hasRunningProcess: row.hasRunningProcess ?? false
  }
}

/** Lift the coordinator handles referenced by any agent's orchestration context. */
export function collectCoordinatorHandles(entries: AgentStatusEntry[]): Set<string> {
  const set = new Set<string>()
  for (const entry of entries) {
    const coord = entry.orchestration?.coordinatorHandle
    if (coord) {
      set.add(coord)
    }
  }
  return set
}

/** Derive the coordinator summary from tasks (no coordinator-status RPC exists). */
export function deriveCoordinatorState(tasks: Task[]): CoordinatorState {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    ready: 0,
    dispatched: 0,
    completed: 0,
    failed: 0,
    blocked: 0
  }
  for (const task of tasks) {
    counts[task.status] += 1
  }
  return { status: deriveRunStatus(counts), counts, activeDispatches: counts.dispatched }
}

/**
 * Honest run status from the task counts (there is no coordinator-status RPC):
 * - **running** when anything is mid-flight (a dispatch is the strongest signal).
 * - **completed** when there are tasks, nothing is in flight, none failed, and at
 *   least one finished — the run reached the end cleanly.
 * - **failed** when nothing is in flight, no work is left to pick up, and at least
 *   one task failed — the run ended with an unresolved failure.
 * - **idle** otherwise (no tasks, or only queued/blocked work waiting to start).
 * `blocked` keeps the run idle (it is waiting on a human, not actively working).
 */
function deriveRunStatus(counts: Record<TaskStatus, number>): CoordinatorRunStatus {
  if (counts.dispatched > 0) {
    return 'running'
  }
  const queued = counts.pending + counts.ready
  if (counts.failed > 0 && queued === 0) {
    return 'failed'
  }
  if (counts.completed > 0 && counts.failed === 0 && queued === 0 && counts.blocked === 0) {
    return 'completed'
  }
  return 'idle'
}

/** Best-effort status timeline for the detail Sheet from a task's terminal state. */
export function deriveTaskHistory(task: Task): TaskDetail['history'] {
  const history: TaskDetail['history'] = [{ status: 'ready', label: 'ready', time: '' }]
  if (task.assigneeHandle) {
    history.push({
      status: 'dispatched-to',
      label: `dispatched → ${task.assigneeHandle}`,
      time: task.startedAt ?? ''
    })
  }
  if (task.status === 'completed') {
    history.push({ status: 'completed', label: 'completed', time: task.completedAt ?? '' })
  } else if (task.status === 'failed') {
    history.push({
      status: 'failed',
      label: `failed${task.attempts ? ` · ${task.attempts}` : ''}`,
      time: task.completedAt ?? ''
    })
  } else if (task.status === 'blocked') {
    history.push({ status: 'blocked', label: 'blocked on gate', time: '' })
  }
  return history
}

/** Parse a JSON-encoded string array, tolerating malformed/empty input. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
