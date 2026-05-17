import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshGitProvider } from './ssh-git-provider'

type MockMultiplexer = {
  request: ReturnType<typeof vi.fn>
}

describe('SshGitProvider agent exec lanes', () => {
  let mux: MockMultiplexer
  let provider: SshGitProvider

  beforeEach(() => {
    mux = { request: vi.fn().mockResolvedValue(undefined) }
    provider = new SshGitProvider('conn-1', mux as never)
  })

  it('reads branch, staged summary, and staged patch remotely', async () => {
    mux.request.mockImplementation(async (method, payload) => {
      expect(method).toBe('git.exec')
      if (payload.args[1] === '--show-current') {
        return { stdout: 'feature/ai-commit\n' }
      }
      if (payload.args[2] === '--name-status') {
        return { stdout: 'M\tREADME.md\n' }
      }
      if (payload.args[2] === '--patch') {
        return { stdout: 'diff --git a/README.md b/README.md\n+hello' }
      }
      throw new Error(`unexpected args: ${payload.args.join(' ')}`)
    })

    const result = await provider.getStagedCommitContext('/home/user/repo')

    expect(result).toEqual({
      branch: 'feature/ai-commit',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: 'diff --git a/README.md b/README.md\n+hello'
    })
    expect(mux.request).toHaveBeenCalledWith('git.exec', {
      args: ['diff', '--cached', '--patch', '--minimal', '--no-color', '--no-ext-diff'],
      cwd: '/home/user/repo'
    })
  })

  it('returns null when nothing is staged', async () => {
    mux.request.mockImplementation(async (_method, payload) => {
      if (payload.args[1] === '--show-current') {
        return { stdout: 'main\n' }
      }
      return { stdout: '' }
    })

    await expect(provider.getStagedCommitContext('/home/user/repo')).resolves.toBeNull()
    expect(mux.request).toHaveBeenCalledTimes(2)
  })

  it('delegates a commit-message plan to the relay', async () => {
    const execResult = {
      stdout: 'Update docs',
      stderr: '',
      exitCode: 0,
      timedOut: false
    }
    mux.request.mockResolvedValue(execResult)

    const result = await provider.executeCommitMessagePlan(
      {
        binary: 'codex',
        args: ['exec', 'PROMPT'],
        stdinPayload: null,
        label: 'Codex'
      },
      '/home/user/repo',
      60_000
    )

    expect(mux.request).toHaveBeenCalledWith(
      'agent.execNonInteractive',
      expect.objectContaining({ cwd: '/home/user/repo', operation: 'commit-message' })
    )
    expect(result).toEqual(execResult)
  })

  it('sends best-effort commit-message cancellation', async () => {
    await provider.cancelGenerateCommitMessage('/home/user/repo')

    expect(mux.request).toHaveBeenCalledWith(
      'agent.cancelExec',
      expect.objectContaining({ cwd: '/home/user/repo', operation: 'commit-message' })
    )
  })

  it('can execute a prepared plan in the pull-request-fields lane', async () => {
    mux.request.mockResolvedValue({
      stdout: '{"title":"Update README"}',
      stderr: '',
      exitCode: 0,
      timedOut: false
    })

    await provider.executeCommitMessagePlan(
      {
        binary: 'codex',
        args: ['exec'],
        stdinPayload: 'prompt',
        label: 'Codex'
      },
      '/home/user/repo',
      60_000,
      'pull-request-fields'
    )

    expect(mux.request).toHaveBeenCalledWith(
      'agent.execNonInteractive',
      expect.objectContaining({
        cwd: '/home/user/repo',
        operation: 'pull-request-fields'
      })
    )
  })

  it('can cancel the pull-request-fields lane', async () => {
    await provider.cancelGenerateCommitMessage('/home/user/repo', 'pull-request-fields')

    expect(mux.request).toHaveBeenCalledWith('agent.cancelExec', {
      cwd: '/home/user/repo',
      operation: 'pull-request-fields'
    })
  })
})
