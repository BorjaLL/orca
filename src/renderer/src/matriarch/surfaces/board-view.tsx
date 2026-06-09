import { useMemo, useState } from 'react'
import { Columns3, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ConnectionState } from '../backend'
import { useBackend } from '../state/backend-context'
import { useLiveFeed, type ContentState } from '../state/use-live-feed'
import { useNow } from '../state/use-now'
import { buildWorkItems, type WorkItem } from '../state/work-items'
import { WorkItemCard } from '../components/work-item-card'
import {
  TONE_CLASS,
  WORK_COLUMN_CONFIG,
  WORK_COLUMN_ORDER,
  type WorkColumn
} from '../components/status-vocabulary'
import { FreshnessIndicator } from '../components/freshness-indicator'
import { EmptyState, ErrorState, Skeleton } from '../components/data-states'

/**
 * The unified command Board: one card per unit of work — orchestration tasks AND
 * terminals (all workspaces, incl. plain shells), with a dispatched task merged
 * into the terminal working it. Reads three feeds (tasks poll, agents push,
 * terminals poll) and buckets the merged work items into the 6 command columns.
 */
export function BoardView({
  connectionState,
  onOpenWorkItem,
  onOpenChipHandle
}: {
  connectionState: ConnectionState
  onOpenWorkItem: (item: WorkItem) => void
  onOpenChipHandle: (handle: string) => void
}): React.JSX.Element {
  const { backend } = useBackend()
  const tasksFeed = useMemo(() => backend.tasks(), [backend])
  const agentsFeed = useMemo(() => backend.agents(), [backend])
  const terminalsFeed = useMemo(() => backend.terminals(), [backend])
  const tasksState = useLiveFeed(tasksFeed)
  const agentsState = useLiveFeed(agentsFeed)
  const terminalsState = useLiveFeed(terminalsFeed)
  const [dagOn, setDagOn] = useState(false)
  // Drives recency decay (done/completed → Parked) on a slow tick.
  const now = useNow(60_000)

  const items = useMemo(
    () =>
      buildWorkItems(
        tasksState.value ?? [],
        agentsState.value ?? [],
        terminalsState.value ?? [],
        now
      ),
    [tasksState.value, agentsState.value, terminalsState.value, now]
  )

  const byColumn = useMemo(() => {
    const map = new Map<WorkColumn, WorkItem[]>()
    for (const column of WORK_COLUMN_ORDER) {
      map.set(column, [])
    }
    for (const item of items) {
      map.get(item.column)?.push(item)
    }
    return map
  }, [items])

  // DAG edges only exist among tasks/dispatches (terminals/agents have none).
  const edgeSummary = useMemo(() => {
    const edges: string[] = []
    for (const item of items) {
      const task = item.task
      if (!task) {
        continue
      }
      for (const dep of task.deps) {
        edges.push(`${dep} → ${task.id}`)
      }
      if (task.parentId) {
        edges.push(`${task.parentId} ⤳ ${task.id}`)
      }
    }
    return edges
  }, [items])

  // Honest combined freshness: the Board reads three feeds, two of which poll, so
  // it is never "live" — surface the oldest update + the slowest poll cadence.
  const states = [tasksState, agentsState, terminalsState]
  const updatedAts = states.map((s) => s.updatedAt).filter((n): n is number => n !== null)
  const updatedAt = updatedAts.length > 0 ? Math.min(...updatedAts) : null
  const pollIntervalMs =
    Math.max(tasksState.pollIntervalMs ?? 0, terminalsState.pollIntervalMs ?? 0) || undefined

  const content: ContentState = !states.some((s) => s.hasLoaded || s.value !== null)
    ? 'loading'
    : states.every((s) => s.error && !s.value)
      ? 'error'
      : items.length === 0
        ? 'empty'
        : 'content'
  const errorMessage = states.find((s) => s.error)?.error?.message ?? 'Could not load the board.'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="text-[15px] font-semibold tracking-tight">Board</span>
        <div className="flex-1" />
        <FreshnessIndicator
          connectionState={connectionState}
          isLive={false}
          updatedAt={updatedAt}
          pollIntervalMs={pollIntervalMs}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDagOn((on) => !on)}
          className={cn('gap-1.5', dagOn && 'border-muted-foreground/40 bg-accent')}
          aria-pressed={dagOn}
        >
          <Workflow className="size-3.5" aria-hidden />
          DAG view{dagOn ? ' · on' : ''}
        </Button>
      </div>

      {content === 'loading' && (
        <div className="flex gap-3.5 overflow-hidden p-4">
          {WORK_COLUMN_ORDER.map((column) => (
            <div key={column} className="flex w-64 shrink-0 flex-col gap-2.5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ))}
        </div>
      )}
      {content === 'error' && <ErrorState message={errorMessage} onRetry={() => undefined} />}
      {content === 'empty' && (
        <EmptyState icon={Columns3} message="No tasks or terminals in this backend yet." />
      )}
      {content === 'content' && (
        <div className="flex min-h-0 flex-1 gap-3.5 overflow-x-auto p-4 scrollbar-sleek">
          {WORK_COLUMN_ORDER.map((column) => {
            const cards = byColumn.get(column) ?? []
            const config = WORK_COLUMN_CONFIG[column]
            const Icon = config.icon
            return (
              <div key={column} className="flex h-full min-h-0 w-64 shrink-0 flex-col gap-2.5">
                <div className="flex shrink-0 items-center gap-1.5 px-0.5 pt-0.5 text-xs font-semibold">
                  <Icon
                    className={cn(
                      'size-3.5',
                      TONE_CLASS[config.tone],
                      config.spin && cards.length > 0 && 'animate-spin'
                    )}
                    aria-hidden
                  />
                  <span>{config.label}</span>
                  <span className="ml-auto font-medium text-muted-foreground">{cards.length}</span>
                </div>
                {/* Each column scrolls independently so a long column (e.g. Parked)
                    is fully reachable instead of being clipped by the row height. */}
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 scrollbar-sleek">
                  {cards.length === 0 ? (
                    <span className="px-0.5 py-1.5 text-xs text-muted-foreground">—</span>
                  ) : (
                    cards.map((item) => (
                      <WorkItemCard
                        key={item.id}
                        item={item}
                        onOpen={onOpenWorkItem}
                        onOpenChip={onOpenChipHandle}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dagOn && content === 'content' && (
        <div className="absolute bottom-3.5 left-1/2 max-w-[80%] -translate-x-1/2 truncate rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground shadow-xs">
          {edgeSummary.length > 0
            ? `Dependency edges · ${edgeSummary.join(' · ')}`
            : 'No dependency edges in this run.'}
        </div>
      )}
    </div>
  )
}
