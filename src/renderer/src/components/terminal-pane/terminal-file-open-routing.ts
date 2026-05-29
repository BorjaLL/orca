import { absolutePathToFileUri } from '@/components/editor/markdown-internal-links'
import { getConnectionId } from '@/lib/connection-context'
import { detectLanguage } from '@/lib/language-detect'
import { isPathInsideWorktree, toWorktreeRelativePath } from '@/lib/terminal-links'
import {
  isRemoteRuntimeFileOperation,
  statRuntimePath,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import { getActiveRuntimeTarget, settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'

type TerminalFileOpenDeps = {
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId?: string | null
}

export function isHtmlFilePath(filePath: string): boolean {
  return /\.html?$/i.test(filePath)
}

function openHtmlFileInBrowser(filePath: string, worktreeId: string): void {
  const store = useAppStore.getState()
  if (worktreeId) {
    // Why: following an HTML file link changes which worktree is foregrounded,
    // so it must record a history visit before opening the browser tab.
    activateAndRevealWorktree(worktreeId)
  }
  const fileUrl = absolutePathToFileUri(filePath)
  const title = filePath.split(/[/\\]/).pop() ?? filePath
  store.createBrowserTab(worktreeId, fileUrl, { title, activate: true })
}

export function getTerminalFileContext(
  worktreeId: string,
  worktreePath: string,
  runtimeEnvironmentId?: string | null
): RuntimeFileOperationArgs {
  const settings = useAppStore.getState().settings
  return {
    settings: settingsForRuntimeOwner(settings, runtimeEnvironmentId),
    worktreeId: worktreeId || null,
    worktreePath,
    connectionId: getConnectionId(worktreeId || null) ?? undefined
  }
}

export function shouldProbeTerminalFilePathThroughRuntime(
  context: RuntimeFileOperationArgs
): boolean {
  // Why: a runtime-owned terminal path belongs to that remote host even when it
  // is outside the runtime worktree, so link probing must not fall back locally.
  return (
    Boolean(context.connectionId) || getActiveRuntimeTarget(context.settings).kind === 'environment'
  )
}

export function isTerminalFilePathLocalToClient(
  context: RuntimeFileOperationArgs,
  filePath: string
): boolean {
  // Why: local OS reveal/open can only receive paths from the client machine,
  // not SSH or remote-runtime paths.
  return (
    !context.connectionId &&
    getActiveRuntimeTarget(context.settings).kind === 'local' &&
    !isRemoteRuntimeFileOperation(context, filePath)
  )
}

let latestOpenDetectedFilePathRequestId = 0

export function openDetectedFilePath(
  filePath: string,
  line: number | null,
  column: number | null,
  deps: TerminalFileOpenDeps
): void {
  const { runtimeEnvironmentId, worktreeId, worktreePath } = deps
  const requestId = ++latestOpenDetectedFilePathRequestId

  void (async () => {
    let statResult
    try {
      const fileContext = getTerminalFileContext(worktreeId, worktreePath, runtimeEnvironmentId)
      const isRemoteRuntimePath = isRemoteRuntimeFileOperation(fileContext, filePath)
      // Why: remote paths don't need local auth — the relay/runtime is the security boundary.
      if (!fileContext.connectionId && !isRemoteRuntimePath) {
        await window.api.fs.authorizeExternalPath({ targetPath: filePath })
      }
      statResult = await statRuntimePath(fileContext, filePath)
    } catch {
      return
    }

    if (requestId !== latestOpenDetectedFilePathRequestId) {
      return
    }

    if (statResult.isDirectory) {
      const fileContext = getTerminalFileContext(worktreeId, worktreePath, runtimeEnvironmentId)
      if (fileContext.connectionId || isRemoteRuntimeFileOperation(fileContext, filePath)) {
        return
      }
      await window.api.shell.openFilePath(filePath)
      return
    }

    // Why: .html/.htm files render in Orca's embedded browser instead of opening
    // as source in Monaco — ⌘/Ctrl+click on an HTML path in the terminal should
    // feel like clicking an http link and render the page, not dump HTML source.
    // Mirrors the editor's "Open Preview to the Side" action.
    const fileContext = getTerminalFileContext(worktreeId, worktreePath, runtimeEnvironmentId)
    if (
      isHtmlFilePath(filePath) &&
      !fileContext.connectionId &&
      !isRemoteRuntimeFileOperation(fileContext, filePath)
    ) {
      openHtmlFileInBrowser(filePath, worktreeId)
      return
    }

    let relativePath = filePath
    if (worktreePath && isPathInsideWorktree(filePath, worktreePath)) {
      const maybeRelative = toWorktreeRelativePath(filePath, worktreePath)
      if (maybeRelative !== null && maybeRelative.length > 0) {
        relativePath = maybeRelative
      }
    }

    const store = useAppStore.getState()
    if (worktreeId) {
      // Why: terminal file links can jump across worktrees. Reusing the shared
      // activation path keeps those jumps in the same history stack as sidebar
      // and palette navigation before the editor opens the destination file.
      activateAndRevealWorktree(worktreeId)
    }

    store.openFile({
      filePath,
      relativePath,
      worktreeId: worktreeId || '',
      language: detectLanguage(filePath),
      mode: 'edit',
      runtimeEnvironmentId
    })

    if (line !== null) {
      const targetColumn = column ?? 1
      store.setPendingEditorReveal(null)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (requestId !== latestOpenDetectedFilePathRequestId) {
            return
          }
          store.setPendingEditorReveal({
            filePath,
            line,
            column: targetColumn,
            matchLength: 0
          })
        })
      })
    }
  })()
}
