import { GitBranch, PenLine, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { WorkItem, WorkItemChip } from '../state/work-items'
import { TONE_CLASS } from './status-vocabulary'
import { LiveDot } from './live-dot'
import { formatAgo, useNow } from '../state/use-now'

/**
 * One card on the terminal-first Board — a terminal/pane (with its agent + task
 * folded in), a live agent with no terminal row, or a queued task. Leads with the
 * terminal's worktree identity; the durable note ("what I'm working on") is the
 * prominent line; the live tool/message is the secondary line. The header glyph
 * reflects the live agent when present (ground truth), else the task, else a
 * plain terminal. The footer's branch chip opens that agent when agent-backed.
 */
export function WorkItemCard({
  item,
  onOpen,
  onOpenChip
}: {
  item: WorkItem
  onOpen: (item: WorkItem) => void
  onOpenChip: (handle: string) => void
}): React.JSX.Element {
  const now = useNow(60_000)
  // Icon/tone/spin are resolved once in work-items.ts (consistent with the column).
  const config = item.config
  const Icon = config.icon
  const tone = TONE_CLASS[config.tone]
  const chip = item.chip
  const ago = item.timestamp !== null ? formatAgo(item.timestamp, now) : null
  // Show the activity line only when it adds something beyond the note.
  const activity = item.summary && item.summary !== item.note ? item.summary : null

  return (
    <Card
      onClick={() => onOpen(item)}
      className={cn(
        'cursor-pointer gap-2 rounded-xl border-border/70 p-3 shadow-xs transition-colors hover:border-muted-foreground/30',
        // Parked (idle agents + plain shells) recede.
        item.column === 'parked' && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5">
        {config.tone === 'blue' && <LiveDot />}
        <Icon
          className={cn('size-3.5 shrink-0', tone, config.spin && 'animate-spin')}
          aria-hidden
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug break-words">
          {item.title}
        </span>
        {item.task?.attempts && (
          <Badge variant="destructive" className="h-[17px] shrink-0 px-1.5 text-[10px]">
            {item.task.attempts}
          </Badge>
        )}
      </div>

      {item.note && (
        <div className="flex items-start gap-1.5 text-[13px] text-foreground/90">
          <PenLine className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="line-clamp-2 break-words">{item.note}</span>
        </div>
      )}

      {activity && (
        <div className="flex items-center gap-1.5 overflow-hidden text-[12px] text-muted-foreground">
          {item.agent?.toolName && <Wrench className="size-3 shrink-0" aria-hidden />}
          <span className="truncate font-mono">{activity}</span>
        </div>
      )}

      {(chip || ago) && (
        <div className="flex min-w-0 items-center gap-2 border-t border-border pt-2">
          {chip && <TerminalChip chip={chip} onOpenChip={onOpenChip} />}
          {ago && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{ago}</span>}
        </div>
      )}
    </Card>
  )
}

/** Branch/worktree chip; a button that opens the agent when agent-backed, else inert. */
function TerminalChip({
  chip,
  onOpenChip
}: {
  chip: WorkItemChip
  onOpenChip: (handle: string) => void
}): React.JSX.Element {
  // Pair the worktree with the branch (e.g. `scrum-team-1/main`) so a bare `main`
  // isn't ambiguous across worktrees; fall back to whichever is present.
  const label =
    chip.worktreeName && chip.branch
      ? `${chip.worktreeName}/${chip.branch}`
      : (chip.branch ?? chip.worktreeName ?? chip.handle)
  const title = label
  const inner = (
    <>
      <GitBranch className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </>
  )
  const className = 'inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground'
  if (!chip.agentBacked) {
    return (
      <span title={title} className={className}>
        {inner}
      </span>
    )
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onOpenChip(chip.handle)
      }}
      className={cn(className, 'hover:text-foreground')}
    >
      {inner}
    </button>
  )
}
