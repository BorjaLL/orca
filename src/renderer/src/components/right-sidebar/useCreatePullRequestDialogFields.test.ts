import { describe, expect, it } from 'vitest'
import {
  buildPullRequestGenerationInput,
  resolveGeneratedPullRequestFieldUpdate
} from './pull-request-field-generation'

describe('buildPullRequestGenerationInput', () => {
  it('normalizes the base ref sent to generation', () => {
    expect(
      buildPullRequestGenerationInput({
        base: ' refs/heads/main ',
        title: 'Current title',
        body: 'Current body',
        draft: false
      })
    ).toEqual({
      base: 'main',
      title: 'Current title',
      body: 'Current body',
      draft: false
    })
  })
})

describe('resolveGeneratedPullRequestFieldUpdate', () => {
  const seed = {
    requestId: 1,
    base: 'main',
    title: '',
    body: '',
    draft: false
  }

  it('normalizes and applies generated fields when the seed still matches', () => {
    expect(
      resolveGeneratedPullRequestFieldUpdate(seed, seed, 1, {
        base: 'refs/heads/main',
        title: 'Add PR generation',
        body: 'Summary',
        draft: true
      })
    ).toEqual({
      ok: true,
      fields: {
        base: 'main',
        title: 'Add PR generation',
        body: 'Summary',
        draft: true
      }
    })
  })

  it('rejects generated fields when the user edited a field while generation ran', () => {
    expect(
      resolveGeneratedPullRequestFieldUpdate(seed, { ...seed, title: 'Manual title' }, 1, {
        base: 'main',
        title: 'Generated title',
        body: 'Generated body',
        draft: false
      })
    ).toEqual({
      ok: false,
      error: 'Fields changed while generating. Run generate again for a fresh draft.'
    })
  })

  it('rejects stale generation responses', () => {
    expect(
      resolveGeneratedPullRequestFieldUpdate(seed, seed, 2, {
        base: 'main',
        title: 'Generated title',
        body: 'Generated body',
        draft: false
      })
    ).toMatchObject({ ok: false })
  })
})
