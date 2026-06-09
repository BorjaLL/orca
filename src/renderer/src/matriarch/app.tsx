import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AgentSnapshot, MatriarchBackend, Task, TerminalSummary } from './backend'
import { BackendContext, useBackend } from './state/backend-context'
import { useLiveFeed } from './state/use-live-feed'
import type { WorkItem } from './state/work-items'
import { useNeedsAttention } from './state/use-attention-feeds'
import type { AttentionItem } from './state/needs-attention'
import { AppShell, type PortalTab } from './components/app-shell'
import { AgentsView } from './surfaces/agents-view'
import { BoardView } from './surfaces/board-view'
import { InboxView } from './surfaces/inbox-view'
import { DetailSheet, type DetailSelection } from './surfaces/detail-sheet'
import { useConnectionState } from './state/use-connection-state'

/**
 * The connected portal. Owns the BackendContext provider so every surface (and
 * the shell hooks below, in PortalSurfaces) runs inside it — the provider must
 * wrap, not sit beside, the consumers.
 */
export function PortalApp({
  backend,
  dark,
  onToggleDark
}: {
  backend: MatriarchBackend
  dark: boolean
  onToggleDark: () => void
}): React.JSX.Element {
  const connectionState = useConnectionState(backend)
  return (
    <BackendContext.Provider value={{ backend, connectionState }}>
      <PortalSurfaces dark={dark} onToggleDark={onToggleDark} />
    </BackendContext.Provider>
  )
}

/** Shell + surfaces + detail Sheet — all consumers of the backend context. */
function PortalSurfaces({
  dark,
  onToggleDark
}: {
  dark: boolean
  onToggleDark: () => void
}): React.JSX.Element {
  const { backend, connectionState } = useBackend()
  // Board is the default surface — it's the terminal-first command center.
  const [tab, setTab] = useState<PortalTab>('board')
  const [selection, setSelection] = useState<DetailSelection>(null)
  // The Needs-attention rail is a shell-level sidebar the user toggles from the
  // header badge (default closed so the Board stays unobstructed).
  const [attentionOpen, setAttentionOpen] = useState(false)

  // Shell freshness reflects the active surface's feed: Agents is live, the
  // Board/Inbox are polled — keep the indicator honest per tab.
  const agentsFeed = useMemo(() => backend.agents(), [backend])
  const tasksFeed = useMemo(() => backend.tasks(), [backend])
  const inboxFeed = useMemo(() => backend.inbox(), [backend])
  const terminalsFeed = useMemo(() => backend.terminals(), [backend])
  const agentsState = useLiveFeed(agentsFeed)
  const tasksState = useLiveFeed(tasksFeed)
  const inboxState = useLiveFeed(inboxFeed)
  const terminalsState = useLiveFeed(terminalsFeed)

  const shellFreshness = tab === 'agents' ? agentsState : tab === 'board' ? tasksState : inboxState

  const attention = useNeedsAttention()

  const agentsValue = agentsState.value
  const terminalsValue = terminalsState.value
  const openAgent = (agent: AgentSnapshot): void => setSelection({ kind: 'agent', agent })
  const openTaskById = (id: string): void => setSelection({ kind: 'task', id })
  const openTask = (task: Task): void => setSelection({ kind: 'task', id: task.id })
  const openTerminal = (terminal: TerminalSummary, agent?: AgentSnapshot, taskId?: string): void =>
    setSelection({ kind: 'terminal', terminal, agent, taskId })
  // Why: a handle may name an agent that has since ended (decayed out of the
  // feed); fall back to its terminal so "View agent"/the chip never silently
  // no-ops (the reported dead-button bug).
  const openAgentByHandle = (handle: string): void => {
    const agent = (agentsValue ?? []).find((a) => a.handle === handle)
    if (agent) {
      openAgent(agent)
      return
    }
    const terminal = (terminalsValue ?? []).find((t) => t.handle === handle)
    if (terminal) {
      openTerminal(terminal)
    }
  }
  // Terminal-first: a card opens its terminal (with the agent + task folded in),
  // else a paneless agent, else a queued task.
  const onOpenWorkItem = (item: WorkItem): void => {
    if (item.terminal) {
      openTerminal(item.terminal, item.agent, item.task?.id)
    } else if (item.agent) {
      openAgent(item.agent)
    } else if (item.task) {
      openTask(item.task)
    }
  }
  // Why: "Open in Orca" focuses that pane in the desktop app (terminal.focus) —
  // the portal's one navigation action back into Orca (user-requested).
  const canOpenInOrca = Boolean(backend.focusInOrca)
  const openInOrca = (handle: string): void => {
    // Surface failures (e.g. the pane has since closed) instead of a silent no-op.
    void backend.focusInOrca?.(handle).catch(() => {
      toast.error('Couldn’t open in Orca — that terminal is no longer running.')
    })
  }

  const canHandToCoordinator = Boolean(backend.handToCoordinator)
  const handToCoordinator = (task: Task): void => {
    const sent = backend.handToCoordinator?.(task)
    if (!sent) {
      return
    }
    toast.promise(sent, {
      loading: 'Handing to the matriarch…',
      success: 'Handed to the matriarch — it will pick this up.',
      error: (err) => (err instanceof Error ? err.message : 'Could not reach the coordinator.')
    })
  }

  // Why: answering a decision gate is the portal's R2 control-surface write
  // (FR25/Story 6.1) over the existing orchestration.gateResolve RPC. Capability-
  // gated on the adapter exposing it, so a read-only backend hides the affordance
  // (NFR10). The toast.promise makes it an explicit, visible action.
  const canResolveGate = Boolean(backend.resolveGate)
  const resolveGate = (gateId: string, resolution: string): void => {
    const sent = backend.resolveGate?.(gateId, resolution)
    if (!sent) {
      return
    }
    toast.promise(sent, {
      loading: 'Answering the gate…',
      success: (gate) => `Gate answered: ${gate.resolution ?? resolution}`,
      error: (err) => (err instanceof Error ? err.message : 'Could not answer the gate.')
    })
  }

  // A rail click always opens detail: task-backed items jump to the task; an
  // escalation/handle-only item opens the full-body attention view, so it never
  // no-ops when the source agent has decayed out of the live feed.
  const onSelectAttention = (item: AttentionItem): void => {
    if (item.taskId) {
      openTaskById(item.taskId)
    } else {
      setSelection({ kind: 'attention', item })
    }
  }

  return (
    <>
      <AppShell
        tab={tab}
        onTabChange={setTab}
        backendName={backend.name}
        connectionState={connectionState}
        freshnessIsLive={shellFreshness.isLive}
        freshnessUpdatedAt={shellFreshness.updatedAt}
        freshnessPollMs={shellFreshness.pollIntervalMs}
        attention={attention}
        attentionOpen={attentionOpen}
        onToggleAttention={() => setAttentionOpen((open) => !open)}
        onSelectAttention={onSelectAttention}
        dark={dark}
        onToggleDark={onToggleDark}
      >
        {tab === 'agents' && <AgentsView onOpenAgent={openAgent} onOpenTask={openTaskById} />}
        {tab === 'board' && (
          <BoardView
            connectionState={connectionState}
            onOpenWorkItem={onOpenWorkItem}
            onOpenChipHandle={openAgentByHandle}
          />
        )}
        {tab === 'inbox' && <InboxView connectionState={connectionState} />}
      </AppShell>

      <DetailSheet
        selection={selection}
        onClose={() => setSelection(null)}
        onViewTaskById={openTaskById}
        onOpenAgentByHandle={openAgentByHandle}
        onOpenInOrca={openInOrca}
        canOpenInOrca={canOpenInOrca}
        onHandToCoordinator={handToCoordinator}
        canHandToCoordinator={canHandToCoordinator}
        onResolveGate={resolveGate}
        canResolveGate={canResolveGate}
      />
    </>
  )
}

/** Apply the dark class to the document; returns [dark, toggle]. Dark by default. */
export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(true)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.body.classList.toggle('dark', dark)
  }, [dark])
  return [dark, () => setDark((value) => !value)]
}
