import { describe, expect, it } from 'vitest'
import {
  providerCapabilities,
  reviewActions,
  reviewUnitLabel,
  supportsCapability,
  type ReviewCapability
} from './review-model'

describe('providerCapabilities', () => {
  it('GitHub supports the full review surface', () => {
    const caps = providerCapabilities('github')
    expect(caps.lineComment).toBe(true)
    expect(caps.threadResolve).toBe(true)
    expect(caps.autoMerge).toBe(true)
    expect(caps.reviewers).toBe(true)
  })
  it('GitLab lacks line-level comments, thread-resolve, auto-merge, reviewers (PRD R3)', () => {
    const caps = providerCapabilities('gitlab')
    expect(caps.create).toBe(true)
    expect(caps.merge).toBe(true)
    expect(caps.comment).toBe(true)
    expect(caps.lineComment).toBe(false)
    expect(caps.threadResolve).toBe(false)
    expect(caps.autoMerge).toBe(false)
    expect(caps.reviewers).toBe(false)
  })
  it('an unknown provider degrades to the safe common subset', () => {
    const caps = providerCapabilities('bitbucket')
    expect(caps.create).toBe(true)
    expect(caps.merge).toBe(true)
    expect(caps.comment).toBe(true)
    // No advanced capability is assumed for an unknown host.
    expect(caps.lineComment).toBe(false)
    expect(caps.autoMerge).toBe(false)
  })
})

describe('supportsCapability', () => {
  it('answers per provider + capability', () => {
    expect(supportsCapability('github', 'autoMerge')).toBe(true)
    expect(supportsCapability('gitlab', 'autoMerge')).toBe(false)
  })
})

describe('reviewUnitLabel', () => {
  it('GitHub is PR, GitLab is MR, unknown is review', () => {
    expect(reviewUnitLabel('github')).toBe('PR')
    expect(reviewUnitLabel('gitlab')).toBe('MR')
    expect(reviewUnitLabel('bitbucket')).toBe('review')
  })
})

describe('reviewActions', () => {
  it('labels create/merge with the provider review noun', () => {
    const gh = reviewActions('github')
    const create = gh.find((a) => a.capability === 'create')
    const merge = gh.find((a) => a.capability === 'merge')
    expect(create?.label).toBe('Create PR')
    expect(merge?.label).toBe('Merge PR')

    const gl = reviewActions('gitlab')
    expect(gl.find((a) => a.capability === 'create')?.label).toBe('Create MR')
  })

  it('enables everything for GitHub', () => {
    expect(reviewActions('github').every((a) => a.enabled)).toBe(true)
  })

  it('disables the unsupported GitLab actions with an explanation (NFR9)', () => {
    const gl = reviewActions('gitlab')
    const lineComment = gl.find((a) => a.capability === 'lineComment')
    expect(lineComment?.enabled).toBe(false)
    expect(lineComment?.disabledReason).toContain('MR on gitlab')
    expect(lineComment?.disabledReason).toContain('inline comment')
  })

  it('covers every capability exactly once', () => {
    const caps = reviewActions('github').map((a) => a.capability)
    const expected: ReviewCapability[] = [
      'create',
      'merge',
      'comment',
      'lineComment',
      'threadResolve',
      'autoMerge',
      'reviewers'
    ]
    expect(new Set(caps)).toEqual(new Set(expected))
    expect(caps).toHaveLength(expected.length)
  })

  it('never throws and yields actions for an unknown provider', () => {
    const actions = reviewActions('bitbucket')
    expect(actions.find((a) => a.capability === 'create')?.enabled).toBe(true)
    expect(actions.find((a) => a.capability === 'reviewers')?.enabled).toBe(false)
  })
})
