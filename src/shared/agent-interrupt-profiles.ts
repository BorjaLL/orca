import type { AgentType } from './agent-status-types'

export type AgentInterruptInputIntent = 'plain-escape' | 'ctrl-c' | 'double-ctrl-c'

export type AgentInterruptProfile = {
  agentType: AgentType
  intents: AgentInterruptInputIntent[]
  settleMs: number
}

export type AgentInterruptInferenceRequest = {
  paneKey: string
  baselineUpdatedAt: number
  baselineStateStartedAt: number
  baselinePrompt: string
  baselineAgentType: AgentType
  intent: AgentInterruptInputIntent
}

export const AGENT_INTERRUPT_PROFILES: readonly AgentInterruptProfile[] = [
  { agentType: 'claude', intents: ['plain-escape', 'double-ctrl-c'], settleMs: 500 },
  { agentType: 'codex', intents: ['plain-escape'], settleMs: 500 },
  { agentType: 'opencode', intents: ['plain-escape'], settleMs: 500 }
]

const AGENT_INTERRUPT_PROFILE_BY_TYPE = new Map(
  AGENT_INTERRUPT_PROFILES.map((profile) => [profile.agentType, profile])
)

export function getAgentInterruptProfile(
  agentType: AgentType | null | undefined
): AgentInterruptProfile | null {
  if (!agentType) {
    return null
  }
  return AGENT_INTERRUPT_PROFILE_BY_TYPE.get(agentType) ?? null
}

export function supportsAgentInterruptIntent(
  agentType: AgentType | null | undefined,
  intent: AgentInterruptInputIntent
): boolean {
  return getAgentInterruptProfile(agentType)?.intents.includes(intent) ?? false
}
