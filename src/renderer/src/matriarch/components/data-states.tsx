import { type LucideIcon, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Quiet empty state: hero icon + one line, never an error tone. */
export function EmptyState({
  icon: Icon,
  message,
  className
}: {
  icon: LucideIcon
  message: string
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2.5 p-16 text-center text-muted-foreground',
        className
      )}
    >
      <Icon className="size-7" aria-hidden />
      <span className="text-sm">{message}</span>
    </div>
  )
}

/** Inline error with a ghost Retry — keeps surrounding chrome usable. */
export function ErrorState({
  message,
  onRetry,
  className
}: {
  message: string
  onRetry?: () => void
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center',
        className
      )}
    >
      <TriangleAlert className="size-7 text-destructive" aria-hidden />
      <span className="max-w-md text-sm text-muted-foreground">{message}</span>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </Button>
      )}
    </div>
  )
}

/** A shimmering skeleton block for first-load (not a blank spinner). */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gradient-to-r from-secondary via-secondary/60 to-secondary',
        className
      )}
      aria-hidden
    />
  )
}

/** A grid of skeleton cards for the Agents/Board first-load state. */
export function SkeletonCards({ count = 6 }: { count?: number }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 p-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[116px] rounded-xl" />
      ))}
    </div>
  )
}
