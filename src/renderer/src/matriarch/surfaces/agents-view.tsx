import { useMemo, useState } from 'react'
import { Search, SearchX, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AgentSnapshot } from '../backend'
import { useBackend } from '../state/backend-context'
import { useLiveFeed, resolveContentState } from '../state/use-live-feed'
import { AgentCard } from '../components/agent-card'
import { SegmentedControl } from '../components/segmented-control'
import { EmptyState, ErrorState, SkeletonCards } from '../components/data-states'

type AgentFilter = 'all' | 'working' | 'waiting' | 'blocked'

const FILTERS: { id: AgentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'working', label: 'Working' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'blocked', label: 'Blocked' }
]

export function AgentsView({
  onOpenAgent,
  onOpenTask
}: {
  onOpenAgent: (agent: AgentSnapshot) => void
  onOpenTask: (taskId: string) => void
}): React.JSX.Element {
  const { backend } = useBackend()
  const feed = useMemo(() => backend.agents(), [backend])
  const state = useLiveFeed(feed)

  const [filter, setFilter] = useState<AgentFilter>('all')
  const [query, setQuery] = useState('')

  // Stable reference to the feed's current value (only changes on emit), so the
  // memos below have a plain-identifier dependency.
  const agentsValue = state.value
  // Agent-type chip is hidden when the fleet is homogeneous (one agentType).
  const showType = useMemo(() => {
    const types = new Set((agentsValue ?? []).map((a) => a.agentType).filter(Boolean))
    return types.size > 1
  }, [agentsValue])

  const shown = useMemo(() => {
    // Coordinator first, then the rest (children).
    const ordered = [...(agentsValue ?? [])].sort(
      (a, b) => Number(b.isCoordinator) - Number(a.isCoordinator)
    )
    const q = query.trim().toLowerCase()
    return ordered.filter((a) => {
      const matchFilter = filter === 'all' || a.state === filter
      const matchQuery =
        !q ||
        a.handle.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q) ||
        a.prompt.toLowerCase().includes(q)
      return matchFilter && matchQuery
    })
  }, [agentsValue, filter, query])

  const content = resolveContentState(state, (v) => v.length === 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="text-[15px] font-semibold tracking-tight">Agents</span>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
        <div className="flex-1" />
        <div className="relative inline-flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search handle or title"
            className="h-8 w-[220px] pl-8 text-sm"
          />
        </div>
      </div>

      {content === 'loading' && <SkeletonCards count={6} />}
      {content === 'error' && (
        <ErrorState
          message={state.error?.message ?? 'Could not load agents.'}
          onRetry={() => undefined}
        />
      )}
      {content === 'empty' && (
        <EmptyState icon={Users} message="No agents are running in this backend yet." />
      )}
      {content === 'content' &&
        (shown.length === 0 ? (
          <EmptyState icon={SearchX} message="No agents match." />
        ) : (
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] content-start gap-3 p-4">
              {shown.map((agent) => (
                <AgentCard
                  key={agent.paneKey}
                  agent={agent}
                  showType={showType}
                  onOpen={onOpenAgent}
                  onOpenTask={onOpenTask}
                />
              ))}
            </div>
          </ScrollArea>
        ))}
    </div>
  )
}
