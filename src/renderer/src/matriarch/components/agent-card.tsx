import { CornerDownRight, GitBranch, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { AgentSnapshot } from '../backend'
import { AGENT_STATE_CONFIG, TONE_CLASS } from './status-vocabulary'
import { LiveDot } from './live-dot'
import { shortTaskId } from './task-card-format'
import { formatAgo, useNow } from '../state/use-now'

export function AgentCard({
  agent,
  showType,
  onOpen,
  onOpenTask
}: {
  agent: AgentSnapshot
  /** Whether to show the agent-type chip (hidden on a homogeneous fleet). */
  showType: boolean
  onOpen: (agent: AgentSnapshot) => void
  onOpenTask: (taskId: string) => void
}): React.JSX.Element {
  const now = useNow(5000)
  const config = AGENT_STATE_CONFIG[agent.state]
  const Icon = config.icon
  const tone = TONE_CLASS[config.tone]
  const attentionTone = agent.state === 'waiting' || agent.state === 'blocked'

  return (
    <Card
      onClick={() => onOpen(agent)}
      className={cn(
        'cursor-pointer gap-2.5 rounded-xl border-border/70 p-3.5 shadow-xs transition-colors hover:border-muted-foreground/30',
        agent.state === 'idle' && 'opacity-60',
        agent.isCoordinator && 'border-muted-foreground/25'
      )}
    >
      <div className="flex items-center gap-1.5">
        {config.tone === 'blue' && <LiveDot />}
        <Icon className={cn('size-3.5', tone, config.spin && 'animate-spin')} aria-hidden />
        <span className={cn('text-xs font-semibold', tone)}>{config.label}</span>
        {agent.isCoordinator && (
          <Badge variant="outline" className="h-[18px] px-1.5 text-[10px]">
            coordinator
          </Badge>
        )}
      </div>

      <div className="line-clamp-2 text-[13px] font-semibold leading-snug break-words">
        {agent.label}
      </div>

      <div
        className={cn(
          'flex items-center gap-1.5 overflow-hidden font-mono text-xs whitespace-nowrap text-muted-foreground',
          attentionTone && tone
        )}
        title={
          agent.toolName
            ? `${agent.toolName} · ${agent.toolInput ?? ''}`
            : agent.lastAssistantMessage
        }
      >
        {agent.toolName ? (
          <>
            <Wrench className="size-3.5 shrink-0" aria-hidden />
            <span className="shrink-0">{agent.toolName}</span>
            {agent.toolInput && <span className="truncate"> · {agent.toolInput}</span>}
          </>
        ) : (
          <span className="truncate font-sans">{agent.lastAssistantMessage ?? agent.prompt}</span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 border-t border-border pt-2.5">
        {showType && agent.agentType && (
          <Badge
            variant="outline"
            className="h-[18px] shrink-0 px-1.5 text-[11px] text-muted-foreground"
          >
            {agent.agentType}
          </Badge>
        )}
        {agent.worktreeName && (
          // Why: worktreeId is Orca's `<uuid>::<path>` composite; show only the
          // folder leaf and truncate so it never overflows into the next card.
          <span
            title={agent.worktreeId}
            className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
          >
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{agent.worktreeName}</span>
          </span>
        )}
        {agent.taskId && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenTask(agent.taskId as string)
            }}
            title={agent.taskId}
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            <CornerDownRight className="size-3" aria-hidden />
            {shortTaskId(agent.taskId)}
          </button>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {formatAgo(agent.stateStartedAt, now)}
        </span>
      </div>
    </Card>
  )
}
