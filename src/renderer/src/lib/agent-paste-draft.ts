import type { TuiAgent } from '../../../shared/types'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { detectAgentStatusFromTitle } from '../../../shared/agent-detection'
import { isShellProcess } from '@/lib/tui-agent-startup'
import { useAppStore } from '@/store'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Pi /
// OpenCode / Gemini) treat the inserted text as a single atomic paste — the
// payload lands in the input buffer as a draft instead of echoing
// character-by-character or triggering line-edit shortcuts. Intentionally
// omit a trailing '\r' so the draft never auto-submits; the user reviews
// and sends the prompt themselves.
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

const POLL_INTERVAL_MS = 120

// Why: empirical timings (node-pty + xterm-headless rig that simulates the
// new-workspace flow): Claude renders idle title at ~500ms, Pi at ~1s,
// Codex needs the input box ready at ~2.5s, OpenCode at ~3s. The floor
// guarantees we don't paste before the slowest known TUI is mounted; the
// stable-foreground signal handles TUIs (Codex) whose title never reads as
// idle because they show a working spinner indefinitely until user input.
const MIN_TUI_READY_MS = 2500
const STABLE_FG_DURATION_MS = 1500
const STABLE_TITLE_DURATION_MS = 800
const TITLE_IDLE_GRACE_MS = 200
const READINESS_TIMEOUT_MS = 12000

/**
 * Wait until the agent on `tabId` has a rendered, input-accepting TUI, then
 * paste `content` into its input buffer using bracketed-paste mode. Never
 * appends `\r`, so the draft stays editable for the user to review/append
 * before sending.
 *
 * Returns true when the paste was issued, false on timeout or missing PTY.
 * `onTimeout` lets the caller surface a UI hint (e.g. toast) when the agent
 * doesn't reach a ready state inside `timeoutMs`.
 *
 * Some agents (Copilot, cursor-agent) gate first-run launches behind a
 * trust/permission menu that captures any keystroke as menu input. Those
 * agents set `skipDraftUrlInjection: true` in TUI_AGENT_CONFIG and this
 * helper returns false without touching the PTY for them — the workspace
 * still opens cleanly, the user just types/pastes the URL themselves once
 * past the menu.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  expectedProcess: string
  content: string
  agent?: TuiAgent
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, expectedProcess, content, agent, timeoutMs, onTimeout } = args

  if (agent && TUI_AGENT_CONFIG[agent].skipDraftUrlInjection) {
    return false
  }

  const ready = await waitForTuiInputReady(tabId, expectedProcess, {
    timeoutMs: timeoutMs ?? READINESS_TIMEOUT_MS
  })
  if (!ready) {
    onTimeout?.()
    return false
  }

  const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
  if (!ptyId) {
    return false
  }

  window.api.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${content}${BRACKETED_PASTE_END}`)
  return true
}

/**
 * Heuristic readiness for "the TUI's input box is mounted and accepting
 * input." Combines three signals:
 *   1. Title parses as `idle` — the strongest signal; only a short grace
 *      is added before declaring ready.
 *   2. Non-shell foreground process held for ≥STABLE_FG_DURATION_MS.
 *   3. Hard floor of MIN_TUI_READY_MS to absorb slow renderers (OpenCode).
 *
 * On timeout, returns true only if a non-shell process is in the
 * foreground — never paste into a bare shell.
 */
async function waitForTuiInputReady(
  tabId: string,
  expectedProcess: string,
  opts: { timeoutMs: number }
): Promise<boolean> {
  const startedAt = Date.now()
  const deadline = startedAt + opts.timeoutMs
  let firstNonShellFgAt: number | null = null
  let firstNonEmptyTitleAt: number | null = null

  while (Date.now() < deadline) {
    const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
    if (!ptyId) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    let foreground = ''
    try {
      foreground = (await window.api.pty.getForegroundProcess(ptyId))?.toLowerCase() ?? ''
    } catch {
      // Ignore transient PTY inspection failures and keep polling.
    }
    const titles = collectPaneTitles(tabId)

    const titleIsIdle = titles.some((t) => detectAgentStatusFromTitle(t) === 'idle')
    const titleIsNonEmpty = titles.some((t) => t.trim().length > 0)
    const fgIsNonShell = isAgentForeground(foreground, expectedProcess)

    const elapsed = Date.now() - startedAt
    if (titleIsIdle && elapsed >= TITLE_IDLE_GRACE_MS) {
      await sleep(TITLE_IDLE_GRACE_MS)
      return true
    }

    if (firstNonEmptyTitleAt === null && titleIsNonEmpty) {
      firstNonEmptyTitleAt = Date.now()
    }
    if (firstNonShellFgAt === null && fgIsNonShell) {
      firstNonShellFgAt = Date.now()
    }

    const fgStable =
      firstNonShellFgAt !== null && Date.now() - firstNonShellFgAt >= STABLE_FG_DURATION_MS
    const titleStable =
      firstNonEmptyTitleAt !== null && Date.now() - firstNonEmptyTitleAt >= STABLE_TITLE_DURATION_MS
    const minimumWaitElapsed = elapsed >= MIN_TUI_READY_MS

    if ((fgStable || titleStable) && minimumWaitElapsed) {
      return true
    }

    await sleep(POLL_INTERVAL_MS)
  }

  // Why: timed out without a clean signal. Fall back to "non-shell foreground
  // exists" so we don't blast the URL into a bare shell prompt if the agent
  // failed to launch.
  const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
  if (!ptyId) {
    return false
  }
  try {
    const foreground = (await window.api.pty.getForegroundProcess(ptyId))?.toLowerCase() ?? ''
    return foreground !== '' && !isShellProcess(foreground)
  } catch {
    return false
  }
}

// Why: argv-mode agents distributed via npm (claude, codex, pi) show up in
// node-pty's `process` field as 'node' even though the underlying binary is
// the agent. That's the strongest "agent has launched" signal we get for
// these wrappers, so accept it like any other non-shell agent foreground.
function isAgentForeground(foreground: string, expectedProcess: string): boolean {
  if (foreground === '' || isShellProcess(foreground)) {
    return false
  }
  return (
    foreground === expectedProcess ||
    foreground.startsWith(`${expectedProcess}.`) ||
    foreground.endsWith(`/${expectedProcess}`) ||
    foreground === 'node'
  )
}

function collectPaneTitles(tabId: string): string[] {
  const state = useAppStore.getState()
  const titles: string[] = []
  const paneTitles = state.runtimePaneTitlesByTabId[tabId]
  if (paneTitles) {
    for (const title of Object.values(paneTitles)) {
      if (title) {
        titles.push(title)
      }
    }
  }
  if (titles.length === 0) {
    for (const tabs of Object.values(state.tabsByWorktree)) {
      const tab = tabs.find((t) => t.id === tabId)
      if (tab?.title) {
        titles.push(tab.title)
        break
      }
    }
  }
  return titles
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
