import { describe, expect, it } from 'vitest'
import { deriveTaskTitle } from './derive-title'

describe('deriveTaskTitle', () => {
  it('returns a short spec unchanged (sans trailing punctuation)', () => {
    expect(deriveTaskTitle('Add a workspace-ports status line.')).toBe(
      'Add a workspace-ports status line'
    )
  })

  it('uses the first non-empty line', () => {
    expect(deriveTaskTitle('\n\nFix the relay timeout\nmore detail here')).toBe(
      'Fix the relay timeout'
    )
  })

  it('truncates long specs on a word boundary with an ellipsis', () => {
    const title = deriveTaskTitle(
      'Add a --workspace-status flag to orca worktree set with CLI passthrough and help text'
    )
    expect(title.endsWith('…')).toBe(true)
    expect([...title].length).toBeLessThanOrEqual(57)
    expect(title).not.toContain('  ')
  })

  it('falls back for empty/whitespace input', () => {
    expect(deriveTaskTitle('')).toBe('Untitled task')
    expect(deriveTaskTitle('   \n  ')).toBe('Untitled task')
  })

  it('hard-clips a single oversized token', () => {
    const title = deriveTaskTitle('x'.repeat(120))
    expect(title.endsWith('…')).toBe(true)
    expect([...title].length).toBeLessThanOrEqual(57)
  })

  it('leads worker prompts with the branch leaf, not the boilerplate first line', () => {
    const spec =
      'You are an autonomous WORKER in Orca worktree branch BorjaLL/cli-workspace-status, implementing ONE focused PR for the Orca repo.\n\nSTEP 1 — PRIOR-ART CHECK'
    expect(deriveTaskTitle(spec)).toBe('cli-workspace-status')
  })

  it('falls back to the first line when a worker prompt names no branch', () => {
    expect(deriveTaskTitle('You are an autonomous WORKER doing the thing')).toBe(
      'You are an autonomous WORKER doing the thing'
    )
  })

  it('keeps the descriptive first line when the spec is not a worker prompt', () => {
    // A branch is named later in the spec, but the first line is already a good
    // title — only worker boilerplate should defer to the branch.
    const spec = "Visually verify the 'Fit columns' change\nOn branch BorjaLL/workboard-fit-columns"
    expect(deriveTaskTitle(spec)).toBe("Visually verify the 'Fit columns' change")
  })
})
