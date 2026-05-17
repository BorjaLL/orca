import { describe, expect, it, vi } from 'vitest'
import { getPullRequestDraftContext } from './pull-request-context'

type ExecResult = { stdout: string; stderr?: string }
type ExecGit = Parameters<typeof getPullRequestDraftContext>[0]

function createExecGit(responses: Record<string, string>): ExecGit {
  return vi.fn(async (args: string[]): Promise<ExecResult> => {
    const key = args.join('\0')
    return { stdout: responses[key] ?? '' }
  })
}

describe('getPullRequestDraftContext', () => {
  it('collects branch-level context with argv-safe git commands', async () => {
    const execGit = createExecGit({
      ['branch\0--show-current']: 'feature/pr-fields\n',
      ['merge-base\0main\0HEAD']: 'abc123\n',
      ['log\0--pretty=format:- %s\0--max-count=50\0abc123..HEAD']: '- feat: add PR fields\n',
      ['diff\0--name-status\0abc123..HEAD']: 'M\tREADME.md\n',
      ['diff\0--patch\0--minimal\0--no-color\0--no-ext-diff\0abc123..HEAD']:
        'diff --git a/README.md b/README.md\n+hello\n'
    })

    await expect(
      getPullRequestDraftContext(execGit, {
        base: 'main',
        currentTitle: 'Draft title',
        currentBody: 'Draft body',
        currentDraft: false
      })
    ).resolves.toEqual({
      branch: 'feature/pr-fields',
      base: 'main',
      currentTitle: 'Draft title',
      currentBody: 'Draft body',
      currentDraft: false,
      commitSummary: '- feat: add PR fields',
      changeSummary: 'M\tREADME.md',
      patch: 'diff --git a/README.md b/README.md\n+hello'
    })

    expect(execGit).toHaveBeenCalledWith(['merge-base', 'main', 'HEAD'], {
      maxBuffer: 10 * 1024 * 1024
    })
    expect(execGit).toHaveBeenCalledWith(
      ['diff', '--patch', '--minimal', '--no-color', '--no-ext-diff', 'abc123..HEAD'],
      { maxBuffer: 10 * 1024 * 1024 }
    )
  })

  it('rejects blank or option-like base refs before running git', async () => {
    const execGit = createExecGit({})

    await expect(
      getPullRequestDraftContext(execGit, {
        base: ' --help ',
        currentTitle: '',
        currentBody: '',
        currentDraft: false
      })
    ).resolves.toBeNull()

    expect(execGit).not.toHaveBeenCalled()
  })

  it('returns null when merge-base is unavailable', async () => {
    const execGit = createExecGit({
      ['branch\0--show-current']: 'feature/pr-fields\n'
    })

    await expect(
      getPullRequestDraftContext(execGit, {
        base: 'main',
        currentTitle: '',
        currentBody: '',
        currentDraft: false
      })
    ).resolves.toBeNull()
  })
})
