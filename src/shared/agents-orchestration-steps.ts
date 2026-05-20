// Per-step copy for the agents-orchestration tile in the Explore Orca modal.
// The notifications step is conditional and gets dropped at runtime when the
// user already has notifications.agentTaskComplete enabled (mock parity:
// docs/feature-wall-agents-orchestration-tile-mock.html).

export type AgentsStepId = 'statuses' | 'usage' | 'orchestration' | 'notifications'

// Bullets can be either a plain sentence or a {leadIn, body} pair so the UI
// can render the bold "headline" lead-in pattern used on the orchestration
// step ("Create clean lanes for parallel work. Spin up isolated...").
export type AgentsStepBullet =
  | string
  | {
      readonly leadIn: string
      readonly body: string
      // When set, the bullet fades in this many ms after the step becomes
      // active. Used on the orchestration step to mirror the mock's reveal
      // sequence (top bullet stays put, bottom bullet appears after a beat).
      readonly fadeInDelayMs?: number
    }

export type AgentsStep = {
  readonly id: AgentsStepId
  // Short label rendered in the bottom stepper.
  readonly name: string
  // Subtitle shown directly under the modal's main title — "you are looking
  // at this slice of the workflow".
  readonly subtitle: string
  // One-sentence summary rendered under the subtitle.
  readonly description: string
  // Optional prose lead-in rendered above the bullet list. Used on the
  // orchestration step so users read the bullets as the answer to a sentence
  // ("Orca CLI enables agents to: …").
  readonly bulletsLeadIn?: string
  readonly bullets: readonly AgentsStepBullet[]
}

export const AGENTS_STEPS: readonly AgentsStep[] = [
  {
    id: 'statuses',
    name: 'Visibility',
    subtitle: 'Agent Visibility',
    description: 'Track every running agent in each workspace.',
    bullets: [
      'Run several agents in one workspace and see exactly which one needs you.',
      'Realtime status — working, asking for permission, finished — for every running agent.',
      'Works with every major coding agent and CLI we ship support for.'
    ]
  },
  {
    id: 'usage',
    name: 'Usage',
    subtitle: 'Usage',
    description:
      'Watch your usage and rate limits across every connected account, so you know when to switch.',
    bullets: [
      'Live usage and rate-limit resets in the bottom bar — for every account you connect.',
      'Hit your limit? Swap accounts inline without leaving the workspace.',
      'Know before you hit a wall, not after a request fails.'
    ]
  },
  {
    id: 'orchestration',
    name: 'Orchestration',
    subtitle: 'Orchestration',
    description:
      'Let agents work as a team — spawn workspaces, message each other, and coordinate using the Orca CLI.',
    bulletsLeadIn: 'Orca CLI enables agents to:',
    bullets: [
      {
        leadIn: 'Create clean lanes for parallel work.',
        body: 'Spin up isolated workspaces for each task, keep changes separated, and move multiple efforts forward at once.'
      },
      {
        leadIn: 'Coordinate as an agent team.',
        body: 'Dispatch tasks, hand off context, ask questions, and collect results through Orca instead of relying on manual copy-paste.',
        fadeInDelayMs: 2200
      }
    ]
  },
  {
    id: 'notifications',
    name: 'Notifications',
    subtitle: 'Notifications',
    description: 'Get a desktop notification the moment an agent finishes or needs your input.',
    bullets: [
      'Native desktop notifications when an agent finishes or asks for permission.',
      'Step away from Orca without losing time when an agent stalls.',
      'Per-event toggles and a custom sound in Settings → Notifications.'
    ]
  }
] as const

export function getAgentsSteps(notificationsAlreadyEnabled: boolean): readonly AgentsStep[] {
  if (notificationsAlreadyEnabled) {
    return AGENTS_STEPS.filter((s) => s.id !== 'notifications')
  }
  return AGENTS_STEPS
}
