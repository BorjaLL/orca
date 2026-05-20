import type { JSX, KeyboardEvent } from 'react'
import {
  FEATURE_WALL_WORKFLOWS,
  type FeatureWallWorkflow,
  type FeatureWallWorkflowId
} from '../../../../shared/feature-wall-workflows'
import { cn } from '@/lib/utils'

export function FeatureWallRail(props: {
  selectedId: FeatureWallWorkflowId
  previewPanelId: string
  railRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>
  onSelect: (workflow: FeatureWallWorkflow) => void
  onRailKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void
}): JSX.Element {
  const { selectedId, previewPanelId, railRefs, onSelect, onRailKeyDown } = props
  return (
    <nav
      className="scrollbar-sleek max-h-44 overflow-y-auto border-b border-border bg-card p-2 md:max-h-none md:border-b-0 md:border-r"
      aria-label="Workflows"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        Workflows
      </div>
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
        {FEATURE_WALL_WORKFLOWS.map((workflow, index) => {
          const isSelected = workflow.id === selectedId
          return (
            <div key={workflow.id}>
              <button
                ref={(node) => {
                  railRefs.current[index] = node
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={previewPanelId}
                tabIndex={isSelected ? 0 : -1}
                data-feature-wall-workflow-id={workflow.id}
                onClick={() => onSelect(workflow)}
                onKeyDown={(event) => onRailKeyDown(event, index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors',
                  'hover:bg-accent',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isSelected && 'bg-accent text-accent-foreground'
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-card font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="truncate font-medium leading-tight">{workflow.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{workflow.meta}</span>
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
