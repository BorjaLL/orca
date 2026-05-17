import { describe, expect, it } from 'vitest'
import { resolvePullRequestGenerationControl } from './pull-request-generation-control'

function baseInput(
  overrides: Partial<Parameters<typeof resolvePullRequestGenerationControl>[0]> = {}
) {
  return {
    submitting: false,
    aiEnabled: true,
    agentId: 'codex',
    customAgentCommand: '',
    base: 'main',
    generating: false,
    ...overrides
  }
}

describe('resolvePullRequestGenerationControl', () => {
  it('shows an enabled control when PR generation can run', () => {
    expect(resolvePullRequestGenerationControl(baseInput())).toEqual({
      visible: true,
      disabled: false,
      disabledReason: undefined
    })
  })

  it('stays hidden when AI commit-message generation is disabled', () => {
    expect(resolvePullRequestGenerationControl(baseInput({ aiEnabled: false }))).toMatchObject({
      visible: false,
      disabled: true,
      disabledReason: 'Enable AI commit messages in Settings → Git.'
    })
  })

  it('explains missing agent configuration', () => {
    expect(resolvePullRequestGenerationControl(baseInput({ agentId: null }))).toMatchObject({
      disabled: true,
      disabledReason: 'Pick an agent in Settings → Git → AI Commit Messages.'
    })
  })

  it('requires a custom command for custom agents', () => {
    expect(
      resolvePullRequestGenerationControl(baseInput({ agentId: 'custom', customAgentCommand: ' ' }))
    ).toMatchObject({
      disabled: true,
      disabledReason: 'Custom command is empty. Add one in Settings → Git → AI Commit Messages.'
    })
  })

  it('requires a base branch before generating', () => {
    expect(resolvePullRequestGenerationControl(baseInput({ base: ' ' }))).toMatchObject({
      disabled: true,
      disabledReason: 'Choose a base branch before generating.'
    })
  })

  it('keeps the control clickable while generating so users can cancel', () => {
    expect(
      resolvePullRequestGenerationControl(baseInput({ submitting: true, generating: true }))
    ).toMatchObject({
      visible: true,
      disabled: false,
      disabledReason: 'Create PR in progress…'
    })
  })
})
