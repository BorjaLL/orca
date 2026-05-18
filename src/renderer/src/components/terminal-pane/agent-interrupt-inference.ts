import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import {
  getAgentInterruptProfile,
  supportsAgentInterruptIntent,
  type AgentInterruptInferenceRequest,
  type AgentInterruptInputIntent
} from '../../../../shared/agent-interrupt-profiles'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'

export type AgentInterruptInference = {
  observeInputIntent(intent: AgentInterruptInputIntent): void
  dispose(): void
}

type AgentInterruptInferenceDeps = {
  paneKey: string
  getStatusEntry: () => AgentStatusEntry | undefined
  inferInterrupt: (request: AgentInterruptInferenceRequest) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type CapturedInterruptBaseline = {
  updatedAt: number
  stateStartedAt: number
  prompt: string
  agentType: NonNullable<AgentStatusEntry['agentType']>
  intent: AgentInterruptInputIntent
}

const DOUBLE_CTRL_C_WINDOW_MS = 750

export function isPlainEscapeKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>
): boolean {
  return (
    event.key === 'Escape' &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function isCtrlCKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>
): boolean {
  return (
    event.key.toLowerCase() === 'c' &&
    !event.repeat &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function createAgentInterruptInference({
  paneKey,
  getStatusEntry,
  inferInterrupt,
  now = () => Date.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer)
}: AgentInterruptInferenceDeps): AgentInterruptInference {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingBaseline: CapturedInterruptBaseline | null = null
  let lastCtrlCAt: number | null = null

  const clearPending = (): void => {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer)
      pendingTimer = null
    }
    pendingBaseline = null
  }

  const captureBaseline = (
    entry: AgentStatusEntry,
    intent: AgentInterruptInputIntent
  ): CapturedInterruptBaseline | null => {
    const agentType = entry.agentType
    if (
      entry.state !== 'working' ||
      !agentType ||
      !supportsAgentInterruptIntent(agentType, intent) ||
      !isExplicitAgentStatusFresh(entry, now(), AGENT_STATUS_STALE_AFTER_MS)
    ) {
      return null
    }
    return {
      updatedAt: entry.updatedAt,
      stateStartedAt: entry.stateStartedAt,
      prompt: entry.prompt,
      agentType,
      intent
    }
  }

  const flushPending = (): void => {
    const baseline = pendingBaseline
    pendingTimer = null
    pendingBaseline = null
    if (!baseline) {
      return
    }

    const entry = getStatusEntry()
    if (
      !entry ||
      entry.state !== 'working' ||
      entry.agentType !== baseline.agentType ||
      entry.prompt !== baseline.prompt ||
      entry.updatedAt !== baseline.updatedAt ||
      entry.stateStartedAt !== baseline.stateStartedAt ||
      !isExplicitAgentStatusFresh(entry, now(), AGENT_STATUS_STALE_AFTER_MS)
    ) {
      return
    }

    inferInterrupt({
      paneKey,
      baselineUpdatedAt: baseline.updatedAt,
      baselineStateStartedAt: baseline.stateStartedAt,
      baselinePrompt: baseline.prompt,
      baselineAgentType: baseline.agentType,
      intent: baseline.intent
    })
  }

  return {
    observeInputIntent(intent) {
      if (intent === 'ctrl-c') {
        const observedAt = now()
        const completedDouble =
          lastCtrlCAt !== null && observedAt - lastCtrlCAt <= DOUBLE_CTRL_C_WINDOW_MS
        lastCtrlCAt = observedAt
        if (!completedDouble) {
          return
        }
        intent = 'double-ctrl-c'
      } else {
        lastCtrlCAt = null
      }
      const entry = getStatusEntry()
      if (!entry) {
        clearPending()
        return
      }
      const baseline = captureBaseline(entry, intent)
      if (!baseline) {
        clearPending()
        return
      }
      const profile = getAgentInterruptProfile(baseline.agentType)
      if (!profile) {
        clearPending()
        return
      }
      clearPending()
      pendingBaseline = baseline
      pendingTimer = setTimer(flushPending, profile.settleMs)
    },
    dispose() {
      clearPending()
      lastCtrlCAt = null
    }
  }
}
