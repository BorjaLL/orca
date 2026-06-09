/* oxlint-disable max-lines -- Why: the task/agent/terminal detail bodies are co-located so the
   right-edge Sheet's variants stay in one file; splitting would scatter closely-related read-only views. */
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ExternalLink,
  Hourglass,
  OctagonAlert,
  Send,
  SquareTerminal,
  X
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { AgentSnapshot, Gate, Task, TaskDetail, TerminalSummary } from '../backend'
import type { AttentionItem } from '../state/needs-attention'
import { useBackend } from '../state/backend-context'
import { AGENT_STATE_CONFIG, TASK_STATUS_CONFIG } from '../components/status-vocabulary'
import { StatePill } from '../components/state-pill'
import { CoordinatorSummary } from '../components/coordinator-summary'
import { formatAgo, useNow } from '../state/use-now'
import {
  buildGateResolution,
  canResolveGate as canResolveGateModel,
  gateStatusLabel
} from './gate-model'

/** Discriminated selection driving the right-edge detail Sheet. */
export type DetailSelection =
  | { kind: 'task'; id: string }
  | { kind: 'agent'; agent: AgentSnapshot }
  | { kind: 'terminal'; terminal: TerminalSummary; agent?: AgentSnapshot; taskId?: string }
  | { kind: 'attention'; item: AttentionItem }
  | null

export function DetailSheet({
  selection,
  onClose,
  onViewTaskById,
  onOpenAgentByHandle,
  onOpenInOrca,
  canOpenInOrca,
  onHandToCoordinator,
  canHandToCoordinator,
  onResolveGate,
  canResolveGate
}: {
  selection: DetailSelection
  onClose: () => void
  onViewTaskById: (taskId: string) => void
  onOpenAgentByHandle: (handle: string) => void
  onOpenInOrca: (handle: string) => void
  canOpenInOrca: boolean
  onHandToCoordinator: (task: Task) => void
  canHandToCoordinator: boolean
  onResolveGate: (gateId: string, resolution: string) => void
  canResolveGate: boolean
}): React.JSX.Element {
  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-[460px]"
      >
        {selection?.kind === 'task' && (
          <TaskDetailBody
            taskId={selection.id}
            onOpenInOrca={onOpenInOrca}
            canOpenInOrca={canOpenInOrca}
            onHandToCoordinator={onHandToCoordinator}
            canHandToCoordinator={canHandToCoordinator}
            onResolveGate={onResolveGate}
            canResolveGate={canResolveGate}
            onClose={onClose}
          />
        )}
        {selection?.kind === 'agent' && (
          <AgentDetailBody
            agent={selection.agent}
            onViewTask={onViewTaskById}
            onOpenInOrca={onOpenInOrca}
            canOpenInOrca={canOpenInOrca}
            onClose={onClose}
          />
        )}
        {selection?.kind === 'terminal' && (
          <TerminalDetailBody
            terminal={selection.terminal}
            agent={selection.agent}
            taskId={selection.taskId}
            onViewTaskById={onViewTaskById}
            onOpenInOrca={onOpenInOrca}
            canOpenInOrca={canOpenInOrca}
            onClose={onClose}
          />
        )}
        {selection?.kind === 'attention' && (
          <AttentionDetailBody
            item={selection.item}
            onViewTaskById={onViewTaskById}
            onOpenAgentByHandle={onOpenAgentByHandle}
            onOpenInOrca={onOpenInOrca}
            canOpenInOrca={canOpenInOrca}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Ghost action that focuses this pane in the desktop Orca app (terminal.focus). */
function OpenInOrcaButton({
  handle,
  onOpenInOrca
}: {
  handle: string
  onOpenInOrca: (handle: string) => void
}): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onOpenInOrca(handle)}>
      Open in Orca
      <ExternalLink className="size-3.5" aria-hidden />
    </Button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
      {children}
    </span>
  )
}

function KeyValue({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-[13px] last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-xs">{v}</span>
    </div>
  )
}

function TaskDetailBody({
  taskId,
  onOpenInOrca,
  canOpenInOrca,
  onHandToCoordinator,
  canHandToCoordinator,
  onResolveGate,
  canResolveGate,
  onClose
}: {
  taskId: string
  onOpenInOrca: (handle: string) => void
  canOpenInOrca: boolean
  onHandToCoordinator: (task: Task) => void
  canHandToCoordinator: boolean
  onResolveGate: (gateId: string, resolution: string) => void
  canResolveGate: boolean
  onClose: () => void
}): React.JSX.Element {
  const { backend } = useBackend()
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    backend
      .taskDetail(taskId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [backend, taskId])

  if (error) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        <SheetTitle className="sr-only">Task detail</SheetTitle>
        <SheetDescription className="sr-only">Failed to load task detail</SheetDescription>
        {error}
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        <SheetTitle className="sr-only">Task detail</SheetTitle>
        <SheetDescription className="sr-only">Loading task detail</SheetDescription>
        Loading…
      </div>
    )
  }

  const config = TASK_STATUS_CONFIG[detail.status]
  // A dispatched/stuck task is a candidate to delegate to the coordinator.
  const canHandOff =
    canHandToCoordinator &&
    (detail.status === 'dispatched' || detail.status === 'failed' || detail.status === 'blocked')

  return (
    <>
      <SheetHeader className="gap-2.5 border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[13px] text-muted-foreground">{detail.id}</span>
          <StatePill config={config} />
          <div className="flex-1" />
          {canHandOff && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => onHandToCoordinator(detail)}
            >
              Hand to matriarch
              <Send className="size-3.5" aria-hidden />
            </Button>
          )}
          {canOpenInOrca && detail.assigneeHandle && (
            <OpenInOrcaButton handle={detail.assigneeHandle} onOpenInOrca={onOpenInOrca} />
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <SheetTitle className="text-[15px] leading-snug font-semibold tracking-tight">
          {detail.title}
        </SheetTitle>
        <SheetDescription className="sr-only">Task {detail.id} detail</SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-6 p-4.5">
          <section className="flex flex-col gap-2">
            <SectionLabel>Spec</SectionLabel>
            <div className="rounded-lg border border-border bg-secondary p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {detail.spec}
              {detail.result ? `\n\n→ ${detail.result}` : ''}
            </div>
          </section>

          <section className="flex flex-col gap-2.5">
            <SectionLabel>Status history</SectionLabel>
            <ol className="flex flex-col">
              {detail.history.map((entry, index) => (
                <li key={index} className="relative flex gap-2.5 pb-3.5 last:pb-0">
                  {index < detail.history.length - 1 && (
                    <span
                      className="absolute top-4 bottom-0 left-[6px] w-px bg-border"
                      aria-hidden
                    />
                  )}
                  <span
                    className="mt-0.5 size-3 shrink-0 rounded-full bg-muted-foreground/40"
                    aria-hidden
                  />
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span>{entry.label}</span>
                    {entry.time && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {entry.time}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>Dispatch context</SectionLabel>
            <div>
              <KeyValue k="Assignee" v={detail.assigneeHandle ?? '—'} />
              <KeyValue k="Attempts" v={detail.attempts ?? '1/3'} />
              <KeyValue k="Dependencies" v={detail.deps.length ? detail.deps.join(', ') : 'none'} />
              {detail.dispatchId && <KeyValue k="Dispatch" v={detail.dispatchId} />}
            </div>
          </section>

          {detail.gate && (
            <GateSection
              gate={detail.gate}
              canResolveGate={canResolveGate}
              onResolveGate={onResolveGate}
            />
          )}

          {detail.relatedMessages.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Related messages</SectionLabel>
              <div className="flex flex-col gap-1.5">
                {detail.relatedMessages.map((message) => (
                  <div key={message.id} className="rounded-md border border-border px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                      {message.fromHandle} → {message.toHandle} · {message.type}
                    </div>
                    <div className="mt-0.5 text-xs leading-relaxed">{message.body}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

/**
 * The related-gate block. When the gate is pending AND the backend exposes
 * resolveGate (capability-gated, NFR10), it renders an answer affordance: each
 * offered option is a one-click answer, plus a free-text fallback. Otherwise it
 * shows the gate read-only (the v1 monitor posture). Validation runs through the
 * pure gate-model so an un-offered option / empty text never reaches the backend.
 */
function GateSection({
  gate,
  canResolveGate,
  onResolveGate
}: {
  gate: Gate
  canResolveGate: boolean
  onResolveGate: (gateId: string, resolution: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const interactive = canResolveGate && canResolveGateModel(gate)

  const answerOption = (option: string): void => {
    const built = buildGateResolution(gate, { mode: 'option', option })
    if (built.ok) {
      onResolveGate(gate.id, built.resolution)
    }
  }
  const answerText = (): void => {
    const built = buildGateResolution(gate, { mode: 'text', text })
    if (built.ok) {
      onResolveGate(gate.id, built.resolution)
      setText('')
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Related gate</SectionLabel>
      <div className="flex flex-col gap-2.5 rounded-lg border border-attention/40 bg-attention/[0.08] p-3">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Hourglass className="size-3.5 text-attention" aria-hidden />
          {gate.question}
        </div>
        <div className="flex flex-col gap-1.5">
          {gate.options.map((option) =>
            interactive ? (
              <Button
                key={option}
                variant="outline"
                size="sm"
                className="justify-start text-xs"
                onClick={() => answerOption(option)}
              >
                {option}
              </Button>
            ) : (
              <div
                key={option}
                className={cn(
                  'rounded-md border border-border bg-background px-2.5 py-1.5 text-xs',
                  gate.resolution === option && 'border-attention/60 font-semibold'
                )}
              >
                {option}
                {gate.resolution === option ? ' · chosen' : ''}
              </div>
            )
          )}
        </div>

        {interactive && (
          <div className="flex items-center gap-1.5">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && answerText()}
              placeholder="Or type an answer…"
              className="h-8 text-xs"
            />
            <Button size="sm" disabled={text.trim().length === 0} onClick={answerText}>
              Answer
            </Button>
          </div>
        )}

        <span className="text-[11px] text-muted-foreground">
          {gate.toHandle ? `Waiting on ${gate.toHandle} · ` : ''}
          {interactive
            ? gateStatusLabel(gate)
            : !canResolveGate
              ? 'read-only'
              : gateStatusLabel(gate)}
        </span>
      </div>
    </section>
  )
}

function AgentDetailBody({
  agent,
  onViewTask,
  onOpenInOrca,
  canOpenInOrca,
  onClose
}: {
  agent: AgentSnapshot
  onViewTask: (taskId: string) => void
  onOpenInOrca: (handle: string) => void
  canOpenInOrca: boolean
  onClose: () => void
}): React.JSX.Element {
  const now = useNow(5000)
  const config = AGENT_STATE_CONFIG[agent.state]

  return (
    <>
      <SheetHeader className="gap-2.5 border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[13px] text-muted-foreground">{agent.handle}</span>
          <StatePill config={config} faded={agent.state === 'idle'} />
          <div className="flex-1" />
          {canOpenInOrca && <OpenInOrcaButton handle={agent.handle} onOpenInOrca={onOpenInOrca} />}
          {agent.taskId && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => onViewTask(agent.taskId as string)}
            >
              View task
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <SheetTitle className="text-[15px] leading-snug font-semibold tracking-tight">
          {agent.prompt || agent.label}
        </SheetTitle>
        <SheetDescription className="sr-only">Agent {agent.handle} detail</SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-6 p-4.5">
          <section className="flex flex-col gap-2">
            <SectionLabel>{agent.toolName ? 'Active tool' : 'Last message'}</SectionLabel>
            <div className="rounded-lg border border-border bg-secondary p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {agent.toolName
                ? `${agent.toolName}(${agent.toolInput ?? ''})`
                : (agent.lastAssistantMessage ?? '—')}
            </div>
          </section>

          {agent.isCoordinator && <CoordinatorSummary />}

          <section className="flex flex-col gap-2">
            <SectionLabel>Context</SectionLabel>
            <div>
              <KeyValue k="Agent type" v={agent.agentType ?? '—'} />
              <KeyValue
                k="Parent"
                v={agent.isCoordinator ? '— (coordinator)' : (agent.parentHandle ?? '—')}
              />
              <KeyValue k="Task" v={agent.taskId ?? '—'} />
              <KeyValue k="Worktree" v={agent.worktreeName ?? agent.worktreeId ?? '—'} />
              <KeyValue k="Run" v={agent.runId ?? '—'} />
              <KeyValue k="Last activity" v={formatAgo(agent.updatedAt, now)} />
            </div>
          </section>
        </div>
      </ScrollArea>
    </>
  )
}

function TerminalDetailBody({
  terminal,
  agent,
  taskId,
  onViewTaskById,
  onOpenInOrca,
  canOpenInOrca,
  onClose
}: {
  terminal: TerminalSummary
  agent?: AgentSnapshot
  taskId?: string
  onViewTaskById: (taskId: string) => void
  onOpenInOrca: (handle: string) => void
  canOpenInOrca: boolean
  onClose: () => void
}): React.JSX.Element {
  const now = useNow(5000)
  // The terminal-first card folds the agent in; reflect its live state when present.
  const agentConfig = agent ? AGENT_STATE_CONFIG[agent.state] : null

  return (
    <>
      <SheetHeader className="gap-2.5 border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[13px] text-muted-foreground">{terminal.handle}</span>
          {agentConfig ? (
            <StatePill config={agentConfig} faded={agent?.state === 'idle'} />
          ) : (
            <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
              <SquareTerminal className="size-3" aria-hidden />
              terminal
            </Badge>
          )}
          <div className="flex-1" />
          {canOpenInOrca && (
            <OpenInOrcaButton handle={terminal.handle} onOpenInOrca={onOpenInOrca} />
          )}
          {taskId && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => onViewTaskById(taskId)}
            >
              View task
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <SheetTitle className="text-[15px] leading-snug font-semibold tracking-tight">
          {terminal.worktreeName ?? terminal.title ?? terminal.handle}
        </SheetTitle>
        <SheetDescription className="sr-only">Terminal {terminal.handle} detail</SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-6 p-4.5">
          {terminal.note && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Note</SectionLabel>
              <div className="rounded-lg border border-border bg-secondary p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap">
                {terminal.note}
              </div>
            </section>
          )}

          {agent && (
            <section className="flex flex-col gap-2">
              <SectionLabel>{agent.toolName ? 'Active tool' : 'Last message'}</SectionLabel>
              <div className="rounded-lg border border-border bg-secondary p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {agent.toolName
                  ? `${agent.toolName}(${agent.toolInput ?? ''})`
                  : (agent.lastAssistantMessage ?? '—')}
              </div>
            </section>
          )}

          {!agent && terminal.preview && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Last output</SectionLabel>
              <div className="rounded-lg border border-border bg-secondary p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {terminal.preview}
              </div>
            </section>
          )}
          <section className="flex flex-col gap-2">
            <SectionLabel>Context</SectionLabel>
            <div>
              <KeyValue k="Worktree" v={terminal.worktreeName ?? '—'} />
              <KeyValue k="Branch" v={terminal.branch ?? '—'} />
              <KeyValue k="Connected" v={terminal.connected ? 'yes' : 'no'} />
              <KeyValue
                k="Last activity"
                v={terminal.lastOutputAt !== null ? formatAgo(terminal.lastOutputAt, now) : '—'}
              />
            </div>
          </section>
        </div>
      </ScrollArea>
    </>
  )
}

/** A needs-attention item (escalation, gate, blocked/failed/waiting). Always shows
 *  the full body — so a click never no-ops even when the source agent has decayed —
 *  plus jumps to the task/agent/pane when those still resolve. */
function AttentionDetailBody({
  item,
  onViewTaskById,
  onOpenAgentByHandle,
  onOpenInOrca,
  canOpenInOrca,
  onClose
}: {
  item: AttentionItem
  onViewTaskById: (taskId: string) => void
  onOpenAgentByHandle: (handle: string) => void
  onOpenInOrca: (handle: string) => void
  canOpenInOrca: boolean
  onClose: () => void
}): React.JSX.Element {
  const { taskId, handle } = item
  const Icon = item.tone === 'red' ? OctagonAlert : Hourglass
  const tone = item.tone === 'red' ? 'text-destructive' : 'text-attention'

  return (
    <>
      <SheetHeader className="gap-2.5 border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
          <span className={cn('text-[13px] font-semibold', tone)}>{item.title}</span>
          {handle && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{handle}</span>
          )}
          <div className="flex-1" />
          {canOpenInOrca && handle && (
            <OpenInOrcaButton handle={handle} onOpenInOrca={onOpenInOrca} />
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <SheetTitle className="sr-only">{item.title}</SheetTitle>
        <SheetDescription className="sr-only">Needs-attention detail</SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-6 p-4.5">
          <section className="flex flex-col gap-2">
            <SectionLabel>Details</SectionLabel>
            <div className="rounded-lg border border-border bg-secondary p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap">
              {item.body}
            </div>
          </section>

          {(taskId || handle) && (
            <section className="flex flex-col gap-2">
              <SectionLabel>Go to</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {taskId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => onViewTaskById(taskId)}
                  >
                    View task
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                )}
                {handle && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => onOpenAgentByHandle(handle)}
                  >
                    View agent
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                )}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
