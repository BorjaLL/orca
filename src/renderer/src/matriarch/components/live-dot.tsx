import { cn } from '@/lib/utils'

/**
 * The single "alive" cue — a pulsing blue dot. Used only where data is genuinely
 * push-fresh; never on polled/stale surfaces (copy-honesty rule).
 */
export function LiveDot({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('relative inline-flex size-[7px]', className)} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-2/60" />
      <span className="relative inline-flex size-[7px] rounded-full bg-chart-2" />
    </span>
  )
}
