import type React from 'react'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'

type TerminalRightClickPasteDeps = {
  event: React.MouseEvent<HTMLDivElement>
  clickedPane: ManagedPane | null
  onPaste: () => Promise<void>
}

export function handleTerminalRightClickPaste({
  event,
  clickedPane,
  onPaste
}: TerminalRightClickPasteDeps): void {
  event.stopPropagation()
  const selection = clickedPane?.terminal.getSelection()
  if (selection) {
    void window.api.ui.writeClipboardText(selection)
    clickedPane?.terminal.clearSelection()
  } else {
    void onPaste()
  }
}
