import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { PlayCircle, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const NUDGE_VISUAL_COUNT = 3
const NUDGE_VISUAL_INTERVAL_MS = 2_000
const NUDGE_VISUAL_COPY = [
  {
    title: 'Parallel work',
    caption: 'Fan tasks across isolated workspaces.'
  },
  {
    title: 'One workspace',
    caption: 'Terminal, browser, editor, and diff stay together.'
  },
  {
    title: 'Review loop',
    caption: 'Send comments back to agents and ship.'
  }
] as const

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    setPrefersReducedMotion(media.matches)
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return prefersReducedMotion
}

export function FeatureTourNudge(): JSX.Element | null {
  const visible = useAppStore((s) => s.featureTourNudgeVisible)
  const activeModal = useAppStore((s) => s.activeModal)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const dismissFeatureTourNudge = useAppStore((s) => s.dismissFeatureTourNudge)
  const openModal = useAppStore((s) => s.openModal)
  const shouldRender = visible && activeModal !== 'feature-wall'
  const updateCardVisible = updateStatus.state !== 'idle' && updateStatus.state !== 'not-available'
  const prefersReducedMotion = usePrefersReducedMotion()
  const [visualIndex, setVisualIndex] = useState(0)
  const [visualPaused, setVisualPaused] = useState(false)

  useEffect(() => {
    if (!shouldRender) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissFeatureTourNudge()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismissFeatureTourNudge, shouldRender])

  useEffect(() => {
    if (!shouldRender || prefersReducedMotion || visualPaused) {
      return
    }
    const timer = window.setInterval(() => {
      setVisualIndex((index) => (index + 1) % NUDGE_VISUAL_COUNT)
    }, NUDGE_VISUAL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [prefersReducedMotion, shouldRender, visualPaused])

  if (!shouldRender) {
    return null
  }

  const handleOpenTour = (): void => {
    openModal('feature-wall', { source: 'popup' })
  }

  return (
    <div
      className={cn(
        'fixed right-4 z-40 w-[360px] max-w-[calc(100vw-32px)]',
        'max-[480px]:left-4 max-[480px]:right-4 max-[480px]:w-auto',
        // Why: UpdateCard owns bottom-10 when visible; keep this education
        // card nearby without covering update actions.
        updateCardVisible ? 'bottom-[220px]' : 'bottom-10'
      )}
    >
      <Card
        className="cursor-pointer gap-0 overflow-hidden py-0"
        role="complementary"
        aria-label="Explore Orca"
        onClick={handleOpenTour}
      >
        <div className="flex flex-col gap-3 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Explore Orca
              </div>
              <h3 className="truncate text-sm font-semibold">See what Orca can do</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={(event) => {
                event.stopPropagation()
                dismissFeatureTourNudge()
              }}
              aria-label="Dismiss Explore Orca"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <FeatureTourNudgeVisual
            index={visualIndex}
            onPauseChange={setVisualPaused}
            reducedMotion={prefersReducedMotion}
          />

          <p
            className="line-clamp-2 text-xs leading-snug text-muted-foreground"
            data-feature-tour-nudge-caption
          >
            A quick walkthrough of the workflows built into Orca.
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            Reopen any time from Help &gt; Explore Orca.
          </p>

          <Button variant="default" size="sm" className="w-full gap-1.5" onClick={handleOpenTour}>
            <PlayCircle className="size-3.5" />
            Take the tour
          </Button>
        </div>
      </Card>
    </div>
  )
}

function FeatureTourNudgeVisual(props: {
  index: number
  onPauseChange: (paused: boolean) => void
  reducedMotion: boolean
}): JSX.Element {
  const { index, onPauseChange, reducedMotion } = props
  const copy = NUDGE_VISUAL_COPY[index] ?? NUDGE_VISUAL_COPY[0]
  return (
    <div
      className="relative h-28 overflow-hidden rounded-md border border-border bg-muted/70 p-3"
      data-feature-tour-nudge-visual
      onPointerEnter={() => onPauseChange(true)}
      onPointerLeave={() => onPauseChange(false)}
      onFocusCapture={() => onPauseChange(true)}
      onBlurCapture={() => onPauseChange(false)}
    >
      <div
        key={index}
        className={cn(
          'size-full',
          !reducedMotion && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-500'
        )}
      >
        {index === 0 ? <ParallelWorkVisual reducedMotion={reducedMotion} /> : null}
        {index === 1 ? <WorkspaceTogetherVisual reducedMotion={reducedMotion} /> : null}
        {index === 2 ? <ReviewLoopVisual reducedMotion={reducedMotion} /> : null}
      </div>
      <div className="absolute bottom-3 left-3 right-12 rounded-md bg-background/80 px-2 py-1 shadow-xs">
        <div className="text-[11px] font-semibold leading-tight text-foreground">{copy.title}</div>
        <div className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {copy.caption}
        </div>
      </div>
      <div className="absolute bottom-5 right-3 flex gap-1">
        {Array.from({ length: NUDGE_VISUAL_COUNT }, (_, dotIndex) => (
          <span
            key={dotIndex}
            className={cn(
              'block h-1 rounded-full transition-all duration-300',
              dotIndex === index ? 'w-3 bg-foreground/70' : 'w-1 bg-foreground/25'
            )}
          />
        ))}
      </div>
    </div>
  )
}

function ParallelWorkVisual(props: { reducedMotion: boolean }): JSX.Element {
  const { reducedMotion } = props
  const laneClassName = (index: number): string =>
    cn(
      'absolute right-0 h-4 rounded-sm border border-border bg-background transition-transform duration-700',
      index === 0 && 'top-1 w-24',
      index === 1 && 'top-7 w-28',
      index === 2 && 'top-[52px] w-20',
      !reducedMotion && 'animate-in fade-in-0 slide-in-from-left-1'
    )

  return (
    <div className="relative h-full">
      <div className="absolute left-0 top-1/2 flex h-7 w-12 -translate-y-1/2 items-center justify-center gap-1 rounded-md border border-border bg-background shadow-xs">
        <span
          className={cn(
            'size-1.5 rounded-full bg-foreground/60',
            !reducedMotion && 'animate-pulse'
          )}
        />
        <span className="size-1.5 rounded-full bg-foreground/30" />
        <span className="size-1.5 rounded-full bg-foreground/20" />
      </div>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={cn(
            'absolute left-16 h-px origin-left bg-border transition-transform duration-700',
            index === 0 && 'top-3 w-20 -rotate-12',
            index === 1 && 'top-9 w-24',
            index === 2 && 'top-[60px] w-20 rotate-12'
          )}
        />
      ))}
      {[0, 1, 2].map((index) => (
        <div key={index} className={laneClassName(index)}>
          <div className="h-full rounded-sm bg-foreground/10" />
        </div>
      ))}
    </div>
  )
}

function WorkspaceTogetherVisual(props: { reducedMotion: boolean }): JSX.Element {
  const { reducedMotion } = props
  return (
    <div className="relative h-full">
      {[
        { label: 'Terminal', className: 'left-0 top-3 w-24' },
        { label: 'Browser', className: 'left-20 top-0 w-28' },
        { label: 'Diff', className: 'left-36 top-6 w-24' }
      ].map((panel, index) => (
        <div
          key={panel.label}
          className={cn(
            'absolute h-12 rounded-md border border-border bg-background p-1.5 shadow-xs',
            panel.className,
            !reducedMotion && 'animate-in fade-in-0 zoom-in-95 duration-500',
            index === 1 && 'delay-100',
            index === 2 && 'delay-200'
          )}
        >
          <div className="mb-1 flex gap-1">
            <span className="size-1 rounded-full bg-foreground/30" />
            <span className="size-1 rounded-full bg-foreground/20" />
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-foreground/30" />
            <div className="h-1 w-2/3 rounded-full bg-foreground/15" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ReviewLoopVisual(props: { reducedMotion: boolean }): JSX.Element {
  const { reducedMotion } = props
  return (
    <div className="relative h-full">
      <div className="absolute left-0 top-1 h-14 w-28 rounded-md border border-border bg-background p-2 shadow-xs">
        <div className="mb-1 h-1 w-16 rounded-full bg-foreground/25" />
        <div className="mb-1 h-1 w-20 rounded-full bg-foreground/15" />
        <div className="h-1 w-12 rounded-full bg-foreground/15" />
      </div>
      <div
        className={cn(
          'absolute left-20 top-8 h-5 w-11 rounded-md border border-border bg-card px-2 py-1 shadow-xs',
          !reducedMotion && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-500 delay-100'
        )}
      >
        <div className="h-1 w-full rounded-full bg-foreground/25" />
      </div>
      <div className="absolute left-36 top-9 h-px w-14 bg-border" />
      <div
        className={cn(
          'absolute right-0 top-5 flex h-9 w-20 items-center justify-center rounded-md border border-border bg-background shadow-xs',
          !reducedMotion && 'animate-in fade-in-0 slide-in-from-left-1 duration-500 delay-200'
        )}
      >
        <span className="size-2 rounded-full bg-foreground/40" />
      </div>
      <div
        className={cn(
          'absolute right-4 top-14 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background',
          !reducedMotion && 'animate-in zoom-in-95 fade-in-0 duration-500 delay-300'
        )}
      >
        ✓
      </div>
    </div>
  )
}
