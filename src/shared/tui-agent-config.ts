import type { TuiAgent } from './types'

export type AgentPromptInjectionMode =
  | 'argv'
  | 'flag-prompt'
  | 'flag-prompt-interactive'
  | 'flag-interactive'
  | 'stdin-after-start'

export type TuiAgentConfig = {
  detectCmd: string
  launchCmd: string
  expectedProcess: string
  promptInjectionMode: AgentPromptInjectionMode
  /** Why: Copilot and Cursor-Agent open with a "do you trust this folder?"
   * permission prompt that consumes any keystrokes (including bracketed
   * paste) as menu input. There's no reliable signal for "trust prompt
   * dismissed" from outside the TUI, so the safest behavior is to skip the
   * draft URL pre-fill for these agents — the workspace still opens, the
   * user just types/pastes the URL themselves once they're past the menu. */
  skipDraftUrlInjection?: boolean
}

// Why: the new-workspace handoff depends on three pieces of per-agent
// knowledge staying in sync: how Orca detects the agent on PATH, which binary
// it actually launches, and whether the initial prompt should be passed as an
// argv flag/argument or typed into the interactive session after startup.
// Centralizing that metadata prevents the picker, launcher, and preflight
// checks from quietly drifting apart as new agents are added.
export const TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig> = {
  claude: {
    detectCmd: 'claude',
    launchCmd: 'claude',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv'
  },
  codex: {
    detectCmd: 'codex',
    launchCmd: 'codex',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv'
  },
  opencode: {
    detectCmd: 'opencode',
    launchCmd: 'opencode',
    expectedProcess: 'opencode',
    promptInjectionMode: 'flag-prompt'
  },
  pi: {
    detectCmd: 'pi',
    launchCmd: 'pi',
    expectedProcess: 'pi',
    promptInjectionMode: 'argv'
  },
  gemini: {
    detectCmd: 'gemini',
    launchCmd: 'gemini',
    expectedProcess: 'gemini',
    promptInjectionMode: 'flag-prompt-interactive'
  },
  aider: {
    detectCmd: 'aider',
    launchCmd: 'aider',
    expectedProcess: 'aider',
    promptInjectionMode: 'stdin-after-start'
  },
  goose: {
    detectCmd: 'goose',
    launchCmd: 'goose',
    expectedProcess: 'goose',
    promptInjectionMode: 'stdin-after-start'
  },
  amp: {
    detectCmd: 'amp',
    launchCmd: 'amp',
    expectedProcess: 'amp',
    promptInjectionMode: 'stdin-after-start'
  },
  kilo: {
    detectCmd: 'kilo',
    launchCmd: 'kilo',
    expectedProcess: 'kilo',
    promptInjectionMode: 'stdin-after-start'
  },
  kiro: {
    // Why: the official Kiro installer (https://cli.kiro.dev/install) places a
    // binary named `kiro-cli` on PATH — there is no `kiro` binary. Keep the
    // TuiAgent id as 'kiro' for stored preferences, but detect/launch/identify
    // the real binary name so the agent is recognized as active.
    detectCmd: 'kiro-cli',
    launchCmd: 'kiro-cli',
    expectedProcess: 'kiro-cli',
    promptInjectionMode: 'stdin-after-start'
  },
  crush: {
    detectCmd: 'crush',
    launchCmd: 'crush',
    expectedProcess: 'crush',
    promptInjectionMode: 'stdin-after-start'
  },
  aug: {
    // Why: the published @augmentcode/auggie npm package installs a binary
    // named `auggie` (not `aug`). Keep the TuiAgent id as 'aug' for stored
    // preferences, but detect/launch/identify the real binary name.
    detectCmd: 'auggie',
    launchCmd: 'auggie',
    expectedProcess: 'auggie',
    promptInjectionMode: 'stdin-after-start'
  },
  cline: {
    detectCmd: 'cline',
    launchCmd: 'cline',
    expectedProcess: 'cline',
    promptInjectionMode: 'stdin-after-start'
  },
  codebuff: {
    detectCmd: 'codebuff',
    launchCmd: 'codebuff',
    expectedProcess: 'codebuff',
    promptInjectionMode: 'stdin-after-start'
  },
  continue: {
    detectCmd: 'continue',
    launchCmd: 'continue',
    expectedProcess: 'continue',
    promptInjectionMode: 'stdin-after-start'
  },
  cursor: {
    detectCmd: 'cursor-agent',
    launchCmd: 'cursor-agent',
    expectedProcess: 'cursor-agent',
    promptInjectionMode: 'argv',
    // Why: cursor-agent opens with a "Do you trust this directory?" prompt
    // that consumes typed input as menu shortcuts ([a]/[w]/[q]). Pasting the
    // URL while the menu is up either selects an option or quits — neither
    // is helpful. Skip the draft pre-fill until/unless we have a reliable
    // signal that the trust menu has been dismissed.
    skipDraftUrlInjection: true
  },
  droid: {
    detectCmd: 'droid',
    launchCmd: 'droid',
    expectedProcess: 'droid',
    promptInjectionMode: 'argv'
  },
  kimi: {
    detectCmd: 'kimi',
    launchCmd: 'kimi',
    expectedProcess: 'kimi',
    promptInjectionMode: 'stdin-after-start'
  },
  'mistral-vibe': {
    detectCmd: 'mistral-vibe',
    launchCmd: 'mistral-vibe',
    expectedProcess: 'mistral-vibe',
    promptInjectionMode: 'stdin-after-start'
  },
  'qwen-code': {
    detectCmd: 'qwen-code',
    launchCmd: 'qwen-code',
    expectedProcess: 'qwen-code',
    promptInjectionMode: 'stdin-after-start'
  },
  rovo: {
    detectCmd: 'rovo',
    launchCmd: 'rovo',
    expectedProcess: 'rovo',
    promptInjectionMode: 'stdin-after-start'
  },
  hermes: {
    detectCmd: 'hermes',
    launchCmd: 'hermes',
    expectedProcess: 'hermes',
    promptInjectionMode: 'stdin-after-start'
  },
  copilot: {
    detectCmd: 'copilot',
    launchCmd: 'copilot',
    expectedProcess: 'copilot',
    // Why: `copilot --prompt <text>` runs non-interactively and exits on
    // completion, which would kill the TUI session Orca is hosting.
    // `-i/--interactive <prompt>` starts an interactive session with the
    // initial prompt pre-executed — the behavior Orca needs.
    promptInjectionMode: 'flag-interactive',
    // Why: Copilot's first-launch trust prompt ("Do you trust the files in
    // this folder?") consumes any keystrokes as numbered-menu input. A
    // pasted URL either picks an option or fails the menu validation. Skip
    // the draft pre-fill — same reasoning as cursor-agent above.
    skipDraftUrlInjection: true
  }
}
