import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  GitPullRequest,
  Hourglass,
  Loader2,
  MinusCircle,
  OctagonAlert,
  PauseCircle,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import type { AgentState, CoordinatorRunStatus, TaskStatus } from '../backend'

/** Color tone → CSS token. Color is signal only (monochrome & quiet). */
export type Tone = 'blue' | 'red' | 'amber' | 'muted' | 'fg'

export const TONE_CLASS: Record<Tone, string> = {
  blue: 'text-chart-2',
  red: 'text-destructive',
  amber: 'text-attention',
  muted: 'text-muted-foreground',
  fg: 'text-foreground'
}

export type StatusConfig = {
  icon: LucideIcon
  tone: Tone
  label: string
  spin?: boolean
}

/** Task status vocabulary (design foundations §4). Completed is quiet, not green. */
export const TASK_STATUS_CONFIG: Record<TaskStatus, StatusConfig> = {
  pending: { icon: CircleDashed, tone: 'muted', label: 'pending' },
  ready: { icon: CircleDot, tone: 'fg', label: 'ready' },
  dispatched: { icon: Loader2, tone: 'blue', label: 'dispatched', spin: true },
  completed: { icon: CheckCircle2, tone: 'muted', label: 'completed' },
  failed: { icon: XCircle, tone: 'red', label: 'failed' },
  blocked: { icon: AlertTriangle, tone: 'amber', label: 'blocked' }
}

/** Agent state vocabulary (4 live + decayed idle). */
export const AGENT_STATE_CONFIG: Record<AgentState, StatusConfig> = {
  working: { icon: Loader2, tone: 'blue', label: 'working', spin: true },
  blocked: { icon: OctagonAlert, tone: 'red', label: 'blocked' },
  waiting: { icon: Hourglass, tone: 'amber', label: 'waiting' },
  done: { icon: CheckCircle2, tone: 'muted', label: 'done' },
  idle: { icon: MinusCircle, tone: 'muted', label: 'idle' }
}

/** Board column order: happy path L→R, off-path tucked before Completed (right edge). */
export const BOARD_COLUMN_ORDER: TaskStatus[] = [
  'pending',
  'ready',
  'dispatched',
  'blocked',
  'failed',
  'completed'
]

/**
 * Unified command-Board columns (read-only). Cards are tasks AND terminals; each
 * lands in a column by a derived work-state (see state/work-items.ts). Only
 * Working (blue) + Needs you (amber) carry column color — failure stays a
 * per-card red icon. Done is reserved: read-only has no merge/ship signal, so it
 * only fills under the future write epic.
 */
export type WorkColumn = 'todo' | 'working' | 'needs-you' | 'review-ship' | 'done' | 'parked'

export const WORK_COLUMN_ORDER: WorkColumn[] = [
  'todo',
  'working',
  'needs-you',
  'review-ship',
  'done',
  'parked'
]

export const WORK_COLUMN_CONFIG: Record<WorkColumn, StatusConfig> = {
  todo: { icon: CircleDashed, tone: 'muted', label: 'Todo' },
  working: { icon: Loader2, tone: 'blue', label: 'Working', spin: true },
  'needs-you': { icon: AlertTriangle, tone: 'amber', label: 'Needs you' },
  'review-ship': { icon: GitPullRequest, tone: 'fg', label: 'Review & ship' },
  done: { icon: CheckCircle2, tone: 'muted', label: 'Done' },
  parked: { icon: PauseCircle, tone: 'muted', label: 'Parked' }
}

/**
 * Coordinator run-status vocabulary for the derived run summary (Story 4.3). Only
 * `running` reads as live (blue, pulsing dot); `failed` is red; `completed` and
 * `idle` are quiet. `pulse` marks the status that should animate the status dot.
 */
export type CoordinatorStatusDisplay = { label: string; tone: Tone; pulse: boolean }

export const COORDINATOR_STATUS_CONFIG: Record<CoordinatorRunStatus, CoordinatorStatusDisplay> = {
  running: { label: 'running', tone: 'blue', pulse: true },
  idle: { label: 'idle', tone: 'muted', pulse: false },
  completed: { label: 'completed', tone: 'muted', pulse: false },
  failed: { label: 'failed', tone: 'red', pulse: false }
}
