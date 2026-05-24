import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { PullRequestAiPane } from './PullRequestAiPane'
import { PULL_REQUEST_AI_PANE_SEARCH_ENTRIES } from './pull-request-ai-search'

function renderPane(settings: GlobalSettings): string {
  return renderToStaticMarkup(
    React.createElement(PullRequestAiPane, {
      settings,
      updateSettings: () => {}
    })
  )
}

function buildSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    ...overrides
  } as GlobalSettings
}

describe('PullRequestAiPane', () => {
  beforeEach(() => {
    useAppStore.setState({ settingsSearchQuery: '' })
  })

  it('renders only the opt-in control before the feature is enabled', () => {
    const markup = renderPane(buildSettings())

    expect(markup).toContain('AI Pull Requests')
    expect(markup).toContain('Enable AI pull request details')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).not.toContain('Which agent drafts your pull request details')
    expect(markup).not.toContain('Thinking effort')
  })

  it('inherits the enabled agent from commit-message settings when PR settings are unset', () => {
    const markup = renderPane(
      buildSettings({
        commitMessageAi: {
          enabled: true,
          agentId: 'codex',
          selectedModelByAgent: { codex: 'gpt-5.5' },
          selectedThinkingByModel: { 'gpt-5.5': 'medium' },
          customPrompt: 'commit style',
          customAgentCommand: ''
        }
      })
    )

    // Why: the pane falls back to commit-message settings until PR settings
    // exist, so the inherited agent/model surface as the starting point.
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('Which agent drafts your pull request details')
    expect(markup).toContain('Thinking effort')
    expect(markup).toContain('commit style')
  })

  it('prefers PR settings over commit-message settings when both exist', () => {
    const markup = renderPane(
      buildSettings({
        commitMessageAi: {
          enabled: false,
          agentId: 'codex',
          selectedModelByAgent: {},
          selectedThinkingByModel: {},
          customPrompt: 'commit style',
          customAgentCommand: ''
        },
        pullRequestAi: {
          enabled: true,
          agentId: 'codex',
          selectedModelByAgent: { codex: 'gpt-5.5' },
          selectedThinkingByModel: {},
          customPrompt: 'PR style',
          customAgentCommand: ''
        }
      })
    )

    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('PR style')
    expect(markup).not.toContain('commit style')
  })

  it('renders custom command settings for custom agents', () => {
    const markup = renderPane(
      buildSettings({
        pullRequestAi: {
          enabled: true,
          agentId: 'custom',
          selectedModelByAgent: {},
          selectedThinkingByModel: {},
          customPrompt: '',
          customAgentCommand: 'ollama run llama3.1 {prompt}'
        }
      })
    )

    expect(markup).toContain('AI Pull Requests')
    expect(markup).toContain('Custom command')
    expect(markup).toContain('ollama run llama3.1 {prompt}')
  })

  it('keeps custom command discoverable in settings search metadata', () => {
    const customCommandEntry = PULL_REQUEST_AI_PANE_SEARCH_ENTRIES.find(
      (entry) => entry.title === 'Custom command'
    )

    expect(customCommandEntry?.keywords).toEqual(
      expect.arrayContaining(['custom', 'command', 'ollama'])
    )
  })
})
