import React from 'react'
import { Check, Star } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type AgentComboboxItemArgs = {
  key: string
  itemValue: string
  isChecked: boolean
  isDefault: boolean
  onSelect: () => void
  onSetDefault?: () => void
  icon: React.ReactNode
  label: string
}

/** Render a single combobox row, optionally wrapped in a right-click context
 *  menu that exposes "Set as default". Extracted from AgentCombobox to keep
 *  that file under the line budget. */
export function renderAgentComboboxItem({
  key,
  itemValue,
  isChecked,
  isDefault,
  onSelect,
  onSetDefault,
  icon,
  label
}: AgentComboboxItemArgs): React.ReactNode {
  const row = (
    <CommandItem
      key={key}
      value={itemValue}
      onSelect={onSelect}
      className="items-center gap-2 px-3 py-1.5"
    >
      <Check className={cn('size-4 text-foreground', isChecked ? 'opacity-100' : 'opacity-0')} />
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
    </CommandItem>
  )
  if (!onSetDefault) {
    return row
  }
  return (
    // Why: z-[70] sits above PopoverContent's z-[60] so the right-click menu
    // renders in front of the still-open combobox popover instead of behind it.
    <ContextMenu key={key}>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="z-[70]">
        <ContextMenuItem onSelect={onSetDefault} disabled={isDefault}>
          <Star className="size-3.5" />
          {isDefault
            ? translate('auto.components.agent.AgentCombobox.1b0d6965fa', 'Current default')
            : translate('auto.components.agent.AgentCombobox.9c6b59fe58', 'Set as default')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
