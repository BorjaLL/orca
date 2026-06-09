import { Hourglass, OctagonAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { AttentionItem } from '../state/needs-attention'

const KIND_ICON: Record<AttentionItem['kind'], LucideIcon> = {
  gate: Hourglass,
  escalation: OctagonAlert,
  'blocked-task': Hourglass,
  'failed-task': OctagonAlert,
  'waiting-agent': Hourglass
}

/** The Needs-attention rail. A shell-level sidebar toggled from the header badge;
 *  each item deep-links to its source (or a full-body detail when it can't). */
export function NeedsAttentionRail({
  items,
  onSelect,
  onClose
}: {
  items: AttentionItem[]
  onSelect: (item: AttentionItem) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <TriangleAlert className="size-3.5 text-attention" aria-hidden />
        <span className="text-[13px] font-semibold">Needs attention</span>
        <Badge variant="attention" className="ml-auto">
          {items.length}
        </Badge>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Hide needs attention">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
          <span className="text-xs">Nothing needs you right now.</span>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2.5 p-3">
            {items.map((item) => {
              const Icon = KIND_ICON[item.kind]
              const tone = item.tone === 'red' ? 'text-destructive' : 'text-attention'
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-muted-foreground/30"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className={cn('size-3.5', tone)} aria-hidden />
                    <span className={tone}>{item.title}</span>
                    {item.handle && (
                      <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground">
                        {item.handle}
                      </span>
                    )}
                  </div>
                  <div className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}
