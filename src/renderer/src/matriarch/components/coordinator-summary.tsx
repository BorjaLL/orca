import { useMemo } from 'react'
import { useBackend } from '../state/backend-context'
import { useLiveFeed } from '../state/use-live-feed'
import {
  BOARD_COLUMN_ORDER,
  COORDINATOR_STATUS_CONFIG,
  TASK_STATUS_CONFIG,
  TONE_CLASS
} from './status-vocabulary'
import { cn } from '@/lib/utils'

/** Dot background per tone (TONE_CLASS is text-only; the status dot needs a fill). */
const DOT_BG: Record<string, string> = {
  blue: 'bg-chart-2',
  red: 'bg-destructive',
  amber: 'bg-attention',
  muted: 'bg-muted-foreground',
  fg: 'bg-foreground'
}

/**
 * The derived coordinator run summary (PRD Story 4.3): run status (running / idle /
 * completed / failed) + counts by task status + active dispatches. Shown in the
 * coordinator's detail Sheet. Honestly labelled "derived" — there is no
 * coordinator-status RPC; the status is inferred from the task counts.
 */
export function CoordinatorSummary(): React.JSX.Element | null {
  const { backend } = useBackend()
  const feed = useMemo(() => backend.coordinator(), [backend])
  const state = useLiveFeed(feed)
  const coordinator = state.value
  if (!coordinator) {
    return null
  }
  const status = COORDINATOR_STATUS_CONFIG[coordinator.status]
  return (
    <section className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
        Run summary <span className="font-normal lowercase">· derived</span>
      </span>
      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={cn('inline-flex items-center gap-1.5 font-semibold', TONE_CLASS[status.tone])}
        >
          <span
            className={cn(
              'size-2 rounded-full',
              DOT_BG[status.tone],
              status.pulse && 'animate-pulse'
            )}
            aria-hidden
          />
          {status.label}
        </span>
        <span className="text-muted-foreground">
          · {coordinator.activeDispatches} active dispatch
          {coordinator.activeDispatches === 1 ? '' : 'es'}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {BOARD_COLUMN_ORDER.map((status) => {
          const config = TASK_STATUS_CONFIG[status]
          const Icon = config.icon
          const count = coordinator.counts[status]
          return (
            <span
              key={status}
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                count === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground'
              )}
            >
              <Icon className={cn('size-3', TONE_CLASS[config.tone])} aria-hidden />
              {count} {status}
            </span>
          )
        })}
      </div>
    </section>
  )
}
