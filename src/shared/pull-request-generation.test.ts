import { describe, expect, it } from 'vitest'
import {
  buildPullRequestFieldsPrompt,
  parseGeneratedPullRequestFields,
  type PullRequestDraftContext
} from './pull-request-generation'

const context: PullRequestDraftContext = {
  branch: 'feature/pr-details',
  base: 'main',
  currentTitle: 'Feature pr details',
  currentBody: '- Add form',
  currentDraft: false,
  commitSummary: '- feat: add generated PR details',
  changeSummary: 'M\tsrc/file.ts',
  patch: 'diff --git a/src/file.ts b/src/file.ts\n+export const value = true'
}

describe('buildPullRequestFieldsPrompt', () => {
  it('asks for compact JSON and includes PR context', () => {
    const prompt = buildPullRequestFieldsPrompt(context, 'Use conventional PR titles.')

    expect(prompt).toContain('Return ONLY compact JSON')
    expect(prompt).toContain('Head branch: feature/pr-details')
    expect(prompt).toContain('Current base: main')
    expect(prompt).toContain('Additional instructions from user:')
    expect(prompt).toContain('Use conventional PR titles.')
  })
})

describe('parseGeneratedPullRequestFields', () => {
  it('parses fenced JSON output', () => {
    const fields = parseGeneratedPullRequestFields(
      '```json\n{"base":"main","title":"fix: add details.","body":"Summary","draft":true}\n```',
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'fix: add details',
      body: 'Summary',
      draft: true
    })
  })

  it('falls back for missing optional values', () => {
    const fields = parseGeneratedPullRequestFields('{"title":""}', context)

    expect(fields).toEqual({
      base: 'main',
      title: 'Feature pr details',
      body: '- Add form',
      draft: false
    })
  })

  it('parses JSON with agent preamble noise', () => {
    const fields = parseGeneratedPullRequestFields(
      'Generating...\n{"base":"origin/main","title":"Add PR generation","body":"Summary\\n","draft":false}',
      context
    )

    expect(fields).toEqual({
      base: 'origin/main',
      title: 'Add PR generation',
      body: 'Summary',
      draft: false
    })
  })

  it('uses a generic title when neither generated nor current title exists', () => {
    const fields = parseGeneratedPullRequestFields('{"title":""}', {
      ...context,
      currentTitle: ''
    })

    expect(fields.title).toBe('Update project files')
  })
})
