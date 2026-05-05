import {
  TUI_AGENT_CONFIG,
  type AgentDraftInjectionStrategy
} from '../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../shared/types'
import { detectAgentStatusFromTitle } from '../../../shared/agent-detection'
import { isShellProcess } from '@/lib/tui-agent-startup'
import { useAppStore } from '@/store'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Gemini)
// treat the inserted text as a single atomic paste — they put it in their
// input buffer as a draft instead of echoing character-by-character or
// triggering line-edit shortcuts. Intentionally omit a trailing '\r' so the
// draft never auto-submits; the user gets to review and send themselves.
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

const CHAR_TYPING_DELAY_MS = 25
const POLL_INTERVAL_MS = 120
// Why: many TUIs render their input box only after a startup splash. Empirical
// timings (test-paste rig in /tmp/opencode): codex ≥ 600ms, pi ≥ 600ms,
// opencode ≥ 3000ms. Wait until we see two consecutive polls that look like
// the TUI is rendered (idle title OR non-shell foreground stable for 1500ms),
// or until this hard floor passes — whichever comes first.
const MIN_TUI_READY_MS = 2500
const STABLE_FG_DURATION_MS = 1500
const READINESS_TIMEOUT_MS = 12000

function resolveDraftStrategy(agent: TuiAgent | undefined): AgentDraftInjectionStrategy {
  if (!agent) {
    return 'bracketed-paste'
  }
  return TUI_AGENT_CONFIG[agent].draftInjectionStrategy ?? 'bracketed-paste'
}

/**
 * Wait for the agent on `tabId` to be ready, then deliver `content` into its
 * input buffer as a non-submitted draft. Strategy is per-agent (see
 * `TUI_AGENT_CONFIG[agent].draftInjectionStrategy`); falls back to bracketed
 * paste when the agent is not specified.
 *
 * Returns true when an injection was issued, false on timeout, missing PTY,
 * or `unsupported` strategy. `onTimeout` lets the caller surface a UI hint
 * (e.g. toast) when the agent doesn't reach a ready state inside the
 * readiness budget.
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
  const strategy = resolveDraftStrategy(agent)
  if (strategy === 'unsupported') {
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

  if (strategy === 'type-chars') {
    await typeChars(ptyId, content)
    return true
  }

  // Why: 'bracketed-paste-slow' is preserved for callers / agents that
  // explicitly opt into a longer wait beyond the standard readiness check.
  // The default readiness logic already accounts for slow-startup TUIs, so
  // the 'slow' variant is mostly a no-op on top, but kept as an escape hatch.
  if (strategy === 'bracketed-paste-slow') {
    await new Promise((resolve) => window.setTimeout(resolve, 800))
  }

  window.api.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${content}${BRACKETED_PASTE_END}`)
  return true
}

/**
 * Heuristic readiness for "the TUI's input box is mounted and accepting
 * input." Combines three signals:
 *   1. `titleSuggestsTuiReady`: the title detector says the agent is in a
 *      visibly-rendered state (idle, working with a real label, etc.) — i.e.
 *      anything other than a bare empty title.
 *   2. `foreground stable for ≥1500ms` on a non-shell process.
 *   3. Hard floor of `MIN_TUI_READY_MS` to absorb slow renderers (OpenCode).
 */
async function waitForTuiInputReady(
  tabId: string,
  expectedProcess: string,
  opts: { timeoutMs: number }
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs
  const startedAt = Date.now()
  let firstNonShellFgAt: number | null = null
  let firstNonEmptyTitleAt: number | null = null

  while (Date.now() < deadline) {
    const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
    if (!ptyId) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS))
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
    const fgIsNonShell =
      foreground !== '' &&
      !isShellProcess(foreground) &&
      // Why: argv-mode agents distributed via npm (claude, codex, pi) show up
      // in node-pty's `process` field as 'node' even though the underlying
      // binary is the agent. That's the strongest "agent has launched" signal
      // we get for these wrappers, so accept it like any other non-shell fg.
      (foreground === expectedProcess ||
        foreground.startsWith(`${expectedProcess}.`) ||
        foreground.endsWith(`/${expectedProcess}`) ||
        foreground === 'node')

    const elapsed = Date.now() - startedAt
    if (titleIsIdle && elapsed >= 200) {
      // Title-idle is the strongest signal; only a tiny grace needed.
      await new Promise((resolve) => window.setTimeout(resolve, 200))
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
    const titleStable = firstNonEmptyTitleAt !== null && Date.now() - firstNonEmptyTitleAt >= 800
    const minimumWaitElapsed = elapsed >= MIN_TUI_READY_MS

    if ((fgStable || titleStable) && minimumWaitElapsed) {
      return true
    }

    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS))
  }

  // Why: timed out without a clean signal. As a last-ditch fallback, only
  // signal ready if a non-shell foreground process is present — this prevents
  // typing the draft into a bare shell prompt when something went wrong.
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

async function typeChars(ptyId: string, content: string): Promise<void> {
  // Why: send characters individually with a small delay so the TUI's input
  // handler can render and debounce between keystrokes. URLs only contain
  // safe characters (no control codes, no tab/space/newline) so each char is
  // a literal keypress with no accidental command-trigger semantics.
  for (const char of content) {
    window.api.pty.write(ptyId, char)
    await new Promise((resolve) => window.setTimeout(resolve, CHAR_TYPING_DELAY_MS))
  }
}
