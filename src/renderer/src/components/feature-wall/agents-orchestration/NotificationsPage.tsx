import type { JSX } from 'react'
import { Bell } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function NotificationsPage(props: { active: boolean }): JSX.Element {
  const { active } = props
  const closeModal = useAppStore((s) => s.closeModal)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  return (
    <div className="relative h-full">
      <div className="px-0.5 pb-0.5 pt-1 text-[13px] font-medium leading-snug">
        Step away — Orca pings you when an agent finishes or asks for permission.
      </div>
      <div
        className="absolute inset-x-0 overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgba(24,24,27,0.06)]"
        style={{
          top: 40,
          bottom: 56,
          background:
            'radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.08), transparent 60%), radial-gradient(120% 80% at 0% 100%, rgba(34, 197, 94, 0.08), transparent 60%), linear-gradient(180deg, rgb(244 244 245) 0%, rgb(228 228 231) 100%)'
        }}
      >
        <div
          className={cn(
            'absolute right-3.5 top-3.5 grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5 rounded-[10px] border border-foreground/10 px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.18),0_2px_4px_rgba(0,0,0,0.08)] backdrop-blur-md transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(.2,.8,.2,1)]',
            active ? 'translate-y-0 opacity-100 delay-300' : '-translate-y-3 opacity-0'
          )}
          style={{ width: 256, background: 'rgba(244,244,245,0.92)' }}
        >
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <Bell className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Orca
            </div>
            <div className="mt-px text-[12.5px] font-bold leading-[1.25] text-foreground">
              Agent finished
            </div>
            <div className="mt-1 text-[11.5px] leading-[1.35] text-foreground">
              Claude Code went idle in <span className="font-semibold">redesign auth flow</span>.
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-2 bottom-2 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-foreground/[0.08] bg-card px-2.5 py-2 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
        <span className="ml-0.5 inline-block size-[9px] rounded-full bg-red-500" aria-hidden />
        <span className="text-[11.5px]">
          <strong>Agent notifications are off.</strong>
          <span className="text-muted-foreground">
            {' '}
            Turn them on in Settings &rarr; Notifications.
          </span>
        </span>
        <Button
          size="sm"
          className="h-7 rounded-md text-[11px] font-semibold"
          onClick={() => {
            closeModal()
            openSettingsTarget({ pane: 'notifications', repoId: null })
            openSettingsPage()
          }}
        >
          Enable
        </Button>
      </div>
    </div>
  )
}
