import type { JSX } from 'react'
import type { AgentsStep, AgentsStepId } from '../../../../shared/agents-orchestration-steps'
import { cn } from '@/lib/utils'

export function AgentsStepper(props: {
  steps: readonly AgentsStep[]
  activeStepId: AgentsStepId
  onSelect: (id: AgentsStepId) => void
}): JSX.Element {
  const { steps, activeStepId, onSelect } = props
  return (
    <div className="flex items-center justify-center gap-1 border-t border-border bg-foreground/[0.02] px-6 py-3">
      {steps.map((step, idx) => {
        const isActive = step.id === activeStepId
        return (
          <span key={step.id} className="flex items-center">
            {idx > 0 ? <span className="mx-0.5 h-px w-4 bg-border" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] outline-none transition-colors',
                'hover:bg-foreground/[0.04]',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isActive && 'bg-foreground/[0.07]'
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={cn(
                  'inline-flex size-[18px] items-center justify-center rounded-full font-mono text-[10px] font-bold',
                  isActive
                    ? 'bg-foreground text-background'
                    : 'bg-foreground/[0.08] text-muted-foreground'
                )}
              >
                {idx + 1}
              </span>
              <span
                className={cn(
                  'leading-none',
                  isActive ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
                )}
              >
                {step.name}
              </span>
            </button>
          </span>
        )
      })}
    </div>
  )
}
