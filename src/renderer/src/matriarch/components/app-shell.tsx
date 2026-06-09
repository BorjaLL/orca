import { Columns3, Inbox, LayoutGrid, Moon, Sun, TriangleAlert, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ConnectionState } from '../backend'
import type { AttentionItem } from '../state/needs-attention'
import { FreshnessIndicator } from './freshness-indicator'
import { NeedsAttentionRail } from './needs-attention-rail'

export type PortalTab = 'agents' | 'board' | 'inbox'

const NAV_ITEMS: { id: PortalTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'agents', label: 'Agents', icon: LayoutGrid },
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'inbox', label: 'Inbox', icon: Inbox }
]

export function AppShell({
  tab,
  onTabChange,
  backendName,
  connectionState,
  freshnessIsLive,
  freshnessUpdatedAt,
  freshnessPollMs,
  attention,
  attentionOpen,
  onToggleAttention,
  onSelectAttention,
  dark,
  onToggleDark,
  children
}: {
  tab: PortalTab
  onTabChange: (tab: PortalTab) => void
  backendName: string
  connectionState: ConnectionState
  freshnessIsLive: boolean
  freshnessUpdatedAt: number | null
  freshnessPollMs?: number
  attention: AttentionItem[]
  attentionOpen: boolean
  onToggleAttention: () => void
  onSelectAttention: (item: AttentionItem) => void
  dark: boolean
  onToggleDark: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-3.5">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <span className="text-base leading-none" aria-hidden>
            ◐
          </span>
          Matriarch
        </div>
        <nav className="flex items-center gap-0.5" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-7.5 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="flex-1" />

        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground">
          <Wifi className="size-3.5" aria-hidden />
          {backendName}
        </span>

        <FreshnessIndicator
          connectionState={connectionState}
          isLive={freshnessIsLive}
          updatedAt={freshnessUpdatedAt}
          pollIntervalMs={freshnessPollMs}
        />

        {attention.length > 0 && (
          <button
            type="button"
            onClick={onToggleAttention}
            title={attentionOpen ? 'Hide needs attention' : 'Show needs attention'}
            aria-pressed={attentionOpen}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border border-attention/45 px-2.5 text-xs font-semibold text-attention-foreground dark:text-attention',
              attentionOpen ? 'bg-attention/25' : 'bg-attention/12'
            )}
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            {attention.length}
          </button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleDark}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        {attentionOpen && (
          <NeedsAttentionRail
            items={attention}
            onSelect={onSelectAttention}
            onClose={onToggleAttention}
          />
        )}
      </main>
    </div>
  )
}
