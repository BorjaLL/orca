import type { SettingsSearchEntry } from './settings-search'

export const PULL_REQUEST_AI_PANE_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    title: 'Enable AI pull request details',
    description: 'Adds a Generate button to the Create Pull Request dialog.',
    keywords: [
      'ai',
      'pull',
      'request',
      'pr',
      'generate',
      'agent',
      'claude',
      'codex',
      'enabled'
    ]
  },
  {
    title: 'Agent',
    description: 'Which agent to invoke when generating pull request details.',
    keywords: ['agent', 'claude', 'codex']
  },
  {
    title: 'Model',
    description: 'Which model the selected agent uses to generate the details.',
    keywords: ['model', 'haiku', 'sonnet', 'opus', 'gpt']
  },
  {
    title: 'Thinking effort',
    description: 'Reasoning effort level for the selected model. Higher levels are slower.',
    keywords: ['thinking', 'effort', 'reasoning']
  },
  {
    title: 'Custom prompt',
    description:
      'Optional instructions appended to the base prompt (e.g. required PR description sections).',
    keywords: ['prompt', 'description', 'template', 'style']
  },
  {
    title: 'Custom command',
    description: 'Command line Orca runs to generate the pull request details.',
    keywords: ['custom', 'command', 'cli', 'binary', 'prompt', 'placeholder', 'ollama']
  }
]
