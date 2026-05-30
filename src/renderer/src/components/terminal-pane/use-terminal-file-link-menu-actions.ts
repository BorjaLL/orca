import { useState, type RefObject } from 'react'
import { useAppStore } from '@/store'
import { openDetectedFilePath } from './terminal-file-open-routing'
import type {
  TerminalFileLinkMenuTarget,
  TerminalFileLinkResolver
} from './terminal-file-link-hit-testing'

type TerminalFileLinkMenuActionsDeps = {
  fileLinkResolverRef: RefObject<TerminalFileLinkResolver | null>
  worktreeId: string
  fallbackCwd: string
  focusMenuPane: () => void
}

type TerminalFileLinkMenuActions = {
  menuLink: TerminalFileLinkMenuTarget | null
  resolveMenuLink: (paneId: number | null, event: MouseEvent) => void
  onOpenLink: () => void
  onRevealLink: () => void
  onOpenLinkExternally: () => void
  onCopyLinkPath: () => Promise<void>
}

export function useTerminalFileLinkMenuActions({
  fileLinkResolverRef,
  worktreeId,
  fallbackCwd,
  focusMenuPane
}: TerminalFileLinkMenuActionsDeps): TerminalFileLinkMenuActions {
  const [menuLink, setMenuLink] = useState<TerminalFileLinkMenuTarget | null>(null)

  const resolveLinkWorktreePath = (): string =>
    useAppStore
      .getState()
      .allWorktrees()
      .find((candidate) => candidate.id === worktreeId)?.path ??
    fallbackCwd ??
    ''

  const resolveMenuLink = (paneId: number | null, event: MouseEvent): void => {
    // Why: resolve the file link under the cursor so the menu can offer
    // Open / Reveal / Copy Path for it. null when not over a known path.
    setMenuLink(paneId !== null ? (fileLinkResolverRef.current?.(paneId, event) ?? null) : null)
  }

  const onOpenLink = (): void => {
    if (!menuLink) {
      return
    }
    // Why: mirror Cmd/Ctrl-click, so HTML files, editor reveal, and line jumps
    // follow the same routing path as direct terminal file-link activation.
    openDetectedFilePath(menuLink.absolutePath, menuLink.line, menuLink.column, {
      worktreeId,
      worktreePath: resolveLinkWorktreePath(),
      runtimeEnvironmentId: menuLink.runtimeEnvironmentId
    })
  }

  const onRevealLink = (): void => {
    // Why: reveal/open-externally hand a path to the local OS; only valid for
    // local files because remote/SSH paths live on another machine.
    if (!menuLink?.isLocal) {
      return
    }
    void window.api.shell.openInFileManager(menuLink.absolutePath)
  }

  const onOpenLinkExternally = (): void => {
    if (!menuLink?.isLocal) {
      return
    }
    void window.api.shell.openFilePath(menuLink.absolutePath)
  }

  const onCopyLinkPath = async (): Promise<void> => {
    if (!menuLink) {
      return
    }
    await window.api.ui.writeClipboardText(menuLink.absolutePath)
    // Why: Radix returns focus to the hidden trigger on close, but xterm only
    // accepts input when its helper textarea is focused.
    focusMenuPane()
  }

  return {
    menuLink,
    resolveMenuLink,
    onOpenLink,
    onRevealLink,
    onOpenLinkExternally,
    onCopyLinkPath
  }
}
