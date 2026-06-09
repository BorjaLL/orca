import { RefreshCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConnectionState } from '../backend'
import { formatAgo, useNow } from '../state/use-now'
import { LiveDot } from './live-dot'
import { resolveFreshness } from './freshness'

/**
 * The shell's honest connection + freshness expression. Resolves, in priority
 * order: Disconnected/Reconnecting → Live (push + fresh) → Stale (overdue) →
 * polled "updated Ns ago · poll". Never labels polled data as "live". The
 * priority ladder itself lives in `resolveFreshness` (pure, unit-tested).
 */
export function FreshnessIndicator({
  connectionState,
  isLive,
  updatedAt,
  pollIntervalMs,
  className
}: {
  connectionState: ConnectionState
  /** Whether the active surface's feed is genuine push. */
  isLive: boolean
  /** ms epoch of the active surface's last data, or null while loading. */
  updatedAt: number | null
  pollIntervalMs?: number
  className?: string
}): React.JSX.Element {
  const now = useNow(1000)
  const { mode, overdue } = resolveFreshness({
    connectionState,
    isLive,
    updatedAt,
    now,
    pollIntervalMs
  })

  if (mode === 'reconnecting') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-attention', className)}>
        <WifiOff className="size-3.5" aria-hidden />
        <span>Reconnecting…</span>
      </span>
    )
  }
  if (mode === 'connecting') {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      >
        <RefreshCw className="size-3" aria-hidden />
        <span>Connecting…</span>
      </span>
    )
  }

  const ago = formatAgo(updatedAt as number, now)

  if (mode === 'live') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-foreground', className)}>
        <LiveDot />
        <span>Live · {ago}</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        overdue && 'text-attention',
        className
      )}
    >
      <RefreshCw className={cn('size-3', overdue && 'animate-spin')} aria-hidden />
      <span>
        updated {ago} ago{isLive ? '' : ' · poll'}
      </span>
    </span>
  )
}
