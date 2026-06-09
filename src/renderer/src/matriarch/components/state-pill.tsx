import { cn } from '@/lib/utils'
import { TONE_CLASS, type StatusConfig } from './status-vocabulary'

/** Icon + label using the status vocabulary; `faded` for decayed/idle. */
export function StatePill({
  config,
  faded = false,
  className
}: {
  config: StatusConfig
  faded?: boolean
  className?: string
}): React.JSX.Element {
  const Icon = config.icon
  const tone = TONE_CLASS[config.tone]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', faded && 'opacity-55', className)}
    >
      <Icon className={cn('size-3.5', tone, config.spin && 'animate-spin')} aria-hidden />
      <span className={cn('font-semibold', tone)}>{config.label}</span>
    </span>
  )
}
