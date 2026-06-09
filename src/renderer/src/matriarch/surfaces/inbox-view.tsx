import { useMemo, useState } from 'react'
import { ArrowRight, Flame, Inbox as InboxIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { ConnectionState, Message, MessageType } from '../backend'
import { useBackend } from '../state/backend-context'
import { useLiveFeed, resolveContentState } from '../state/use-live-feed'
import { FreshnessIndicator } from '../components/freshness-indicator'
import { EmptyState, ErrorState, Skeleton } from '../components/data-states'
import { collectRecipients, countByType as countMessagesByType, orderInbox } from './inbox-model'

const TYPE_VARIANT: Record<MessageType, 'outline' | 'secondary' | 'destructive' | 'attention'> = {
  status: 'outline',
  dispatch: 'outline',
  worker_done: 'secondary',
  merge_ready: 'secondary',
  heartbeat: 'outline',
  handoff: 'outline',
  escalation: 'destructive',
  decision_gate: 'attention'
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: 'text-destructive',
  high: 'text-attention',
  normal: 'text-muted-foreground'
}

/** Stable empty reference so memo deps don't churn while loading. */
const EMPTY_MESSAGES: Message[] = []

const TYPE_FILTERS: (MessageType | 'all')[] = [
  'all',
  'escalation',
  'decision_gate',
  'worker_done',
  'merge_ready',
  'status',
  'dispatch',
  'handoff',
  'heartbeat'
]

export function InboxView({
  connectionState
}: {
  connectionState: ConnectionState
}): React.JSX.Element {
  const { backend } = useBackend()
  const feed = useMemo(() => backend.inbox(), [backend])
  const state = useLiveFeed(feed)

  const [recipient, setRecipient] = useState<string>('all')
  const [type, setType] = useState<MessageType | 'all'>('all')

  // Stable reference to the feed's current value (only changes on emit).
  const messagesValue = state.value
  const messages = messagesValue ?? EMPTY_MESSAGES

  // Recipients drawn from the data so the filter list always resolves.
  const recipients = useMemo(() => collectRecipients(messagesValue ?? []), [messagesValue])

  const countByType = (t: MessageType | 'all'): number => countMessagesByType(messages, t)

  // Filtered + ordered newest-first (an audit trail reads best most-recent-first).
  const shown = useMemo(
    () => orderInbox(messagesValue ?? [], recipient, type),
    [messagesValue, recipient, type]
  )

  const content = resolveContentState(state, (v) => v.length === 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="text-[15px] font-semibold tracking-tight">Inbox</span>
        <span className="text-xs text-muted-foreground">
          Audit trail · {messages.length} messages
        </span>
        <div className="flex-1" />
        <FreshnessIndicator
          connectionState={connectionState}
          isLive={state.isLive}
          updatedAt={state.updatedAt}
          pollIntervalMs={state.pollIntervalMs}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[220px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-4 scrollbar-sleek">
          <FilterGroup label="Recipient">
            {recipients.map((r) => (
              <FilterRow
                key={r}
                active={recipient === r}
                onClick={() => setRecipient(r)}
                mono={r !== 'all'}
                label={r === 'all' ? 'All handles' : r}
              />
            ))}
          </FilterGroup>
          <FilterGroup label="Message type">
            {TYPE_FILTERS.map((t) => (
              <FilterRow
                key={t}
                active={type === t}
                onClick={() => setType(t)}
                label={t === 'all' ? 'All types' : t}
                count={countByType(t)}
              />
            ))}
          </FilterGroup>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {content === 'loading' && (
            <div className="flex flex-col gap-px p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}
          {content === 'error' && (
            <ErrorState
              message={state.error?.message ?? 'Could not load the message log.'}
              onRetry={() => undefined}
            />
          )}
          {content === 'empty' && <EmptyState icon={InboxIcon} message="No messages yet." />}
          {content === 'content' &&
            (shown.length === 0 ? (
              <EmptyState icon={InboxIcon} message="No messages match." />
            ) : (
              <ScrollArea className="flex-1">
                <ul>
                  {shown.map((message) => (
                    <MessageRow key={message.id} message={message} />
                  ))}
                </ul>
              </ScrollArea>
            ))}
        </div>
      </div>
    </div>
  )
}

function MessageRow({ message }: { message: Message }): React.JSX.Element {
  const attention = message.type === 'escalation' || message.type === 'decision_gate'
  return (
    <li
      className={cn(
        'flex items-start gap-3 border-b border-border px-4 py-3 hover:bg-accent',
        attention && 'shadow-[inset_2px_0_0_var(--attention)]'
      )}
    >
      <span className="flex min-w-[168px] items-center gap-1.5 font-mono text-xs whitespace-nowrap">
        {message.fromHandle}
        <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
        {message.toHandle}
      </span>
      <Badge variant={TYPE_VARIANT[message.type]} className="text-[11px]">
        {message.type}
      </Badge>
      {message.priority !== 'normal' && (
        <span title={message.priority} className="inline-flex">
          <Flame className={cn('size-3.5', PRIORITY_TONE[message.priority])} aria-hidden />
        </span>
      )}
      <span className="flex-1 text-[13px] leading-relaxed">{message.body}</span>
      {message.createdAt && (
        <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
          {message.createdAt}
        </span>
      )}
    </li>
  )
}

function FilterGroup({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterRow({
  active,
  onClick,
  label,
  count,
  mono
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  mono?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-sm px-2 py-1 text-left text-[13px] transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
        mono && 'font-mono text-xs'
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="ml-auto text-[11px]">{count}</span>}
    </button>
  )
}
