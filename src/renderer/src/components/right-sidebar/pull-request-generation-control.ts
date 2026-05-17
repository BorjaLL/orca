import { isCustomAgentId } from '../../../../shared/commit-message-agent-spec'

type PullRequestGenerationControlInput = {
  submitting: boolean
  aiEnabled: boolean
  agentId: string | null
  customAgentCommand: string
  base: string
  generating: boolean
}

export type PullRequestGenerationControlState = {
  visible: boolean
  disabled: boolean
  disabledReason?: string
}

export function resolvePullRequestGenerationControl({
  submitting,
  aiEnabled,
  agentId,
  customAgentCommand,
  base,
  generating
}: PullRequestGenerationControlInput): PullRequestGenerationControlState {
  let disabledReason: string | undefined
  if (submitting) {
    disabledReason = 'Create PR in progress…'
  } else if (!aiEnabled) {
    disabledReason = 'Enable AI commit messages in Settings → Git.'
  } else if (!agentId) {
    disabledReason = 'Pick an agent in Settings → Git → AI Commit Messages.'
  } else if (isCustomAgentId(agentId) && !customAgentCommand.trim()) {
    disabledReason = 'Custom command is empty. Add one in Settings → Git → AI Commit Messages.'
  } else if (!base.trim()) {
    disabledReason = 'Choose a base branch before generating.'
  }

  return {
    visible: aiEnabled,
    // Why: the generating state swaps this button into a cancel affordance;
    // keeping it enabled is what lets users stop a long agent run.
    disabled: !generating && Boolean(disabledReason),
    disabledReason
  }
}
