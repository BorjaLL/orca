import { cn } from '@/lib/utils'

export type SegmentOption<T extends string> = { id: T; label: string }

/** A quiet segmented filter (matches the prototype's toggle group). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('inline-flex gap-0.5 rounded-md bg-secondary p-0.5', className)}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            className={cn(
              'h-7 rounded-[calc(var(--radius-md)-2px)] px-2.5 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
