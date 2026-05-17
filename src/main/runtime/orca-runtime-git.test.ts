import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type * as GitStatusModule from '../git/status'
import type * as SshGitDispatchModule from '../providers/ssh-git-dispatch'
import type * as CommitMessageTextGenerationModule from '../text-generation/commit-message-text-generation'
import type * as PullRequestContextModule from '../text-generation/pull-request-context'
import { RuntimeGitCommands, type ResolvedRuntimeGitWorktree } from './orca-runtime-git'

const mocks = vi.hoisted(() => ({
  getStagedCommitContext: vi.fn(),
  generateCommitMessageFromContext: vi.fn(),
  generatePullRequestFieldsFromContext: vi.fn(),
  resolveCommitMessageSettings: vi.fn(),
  getPullRequestDraftContext: vi.fn(),
  getSshGitProvider: vi.fn()
}))

vi.mock('../git/status', async () => ({
  ...(await vi.importActual<typeof GitStatusModule>('../git/status')),
  getStagedCommitContext: mocks.getStagedCommitContext
}))

vi.mock('../text-generation/commit-message-text-generation', async () => ({
  ...(await vi.importActual<typeof CommitMessageTextGenerationModule>(
    '../text-generation/commit-message-text-generation'
  )),
  generateCommitMessageFromContext: mocks.generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext: mocks.generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings: mocks.resolveCommitMessageSettings
}))

vi.mock('../text-generation/pull-request-context', async () => ({
  ...(await vi.importActual<typeof PullRequestContextModule>(
    '../text-generation/pull-request-context'
  )),
  getPullRequestDraftContext: mocks.getPullRequestDraftContext
}))

vi.mock('../providers/ssh-git-dispatch', async () => ({
  ...(await vi.importActual<typeof SshGitDispatchModule>('../providers/ssh-git-dispatch')),
  getSshGitProvider: mocks.getSshGitProvider
}))

const tempDirs: string[] = []

function makeWorktree(path: string): ResolvedRuntimeGitWorktree {
  return {
    id: 'wt-1',
    repoId: 'repo-1',
    path,
    git: {
      path,
      branch: 'main',
      bare: false,
      detached: false,
      head: 'a'.repeat(40)
    }
  } as unknown as ResolvedRuntimeGitWorktree
}

function makeCommands(worktreePath: string): RuntimeGitCommands {
  return new RuntimeGitCommands({
    resolveRuntimeGitTarget: async () => ({ worktree: makeWorktree(worktreePath) }),
    getRuntimeSettings: () => ({}) as GlobalSettings
  })
}

describe('RuntimeGitCommands', () => {
  beforeEach(() => {
    mocks.getStagedCommitContext.mockReset()
    mocks.generateCommitMessageFromContext.mockReset()
    mocks.generatePullRequestFieldsFromContext.mockReset()
    mocks.resolveCommitMessageSettings.mockReset()
    mocks.getPullRequestDraftContext.mockReset()
    mocks.getSshGitProvider.mockReset()
  })

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('rejects slash-only git mutation paths before they can target the worktree root', async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'orca-runtime-git-'))
    tempDirs.push(worktreePath)
    const commands = makeCommands(worktreePath)

    await expect(commands.bulkDiscardRuntimeGitPaths('id:wt-1', ['///'])).rejects.toThrow(
      'invalid_relative_path'
    )
    await expect(commands.discardRuntimeGitPath('id:wt-1', '///')).rejects.toThrow(
      'invalid_relative_path'
    )
  })

  it('prepares the selected local agent environment before generating commit messages', async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'orca-runtime-git-'))
    tempDirs.push(worktreePath)
    const context = {
      branch: 'main',
      stagedSummary: 'M\tREADME.md',
      stagedPatch: '+hello'
    }
    const params = { agentId: 'codex', model: 'gpt-5.4-mini', thinkingLevel: 'low' }
    mocks.resolveCommitMessageSettings.mockReturnValue({ ok: true, params })
    mocks.getStagedCommitContext.mockResolvedValue(context)
    mocks.generateCommitMessageFromContext.mockResolvedValue({
      success: true,
      message: 'docs: update readme'
    })
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({ worktree: makeWorktree(worktreePath) }),
      getRuntimeSettings: () =>
        ({
          commitMessageAi: { enabled: true, agentId: 'codex' },
          agentCmdOverrides: {},
          enableGitHubAttribution: false
        }) as GlobalSettings,
      getCommitMessageAgentEnvironment: () => ({
        prepareForCodexLaunch: () => '/managed/codex-home'
      })
    })

    await expect(commands.generateRuntimeCommitMessage('id:wt-1')).resolves.toEqual({
      success: true,
      message: 'docs: update readme'
    })

    expect(mocks.generateCommitMessageFromContext).toHaveBeenCalledWith(
      context,
      params,
      expect.objectContaining({
        kind: 'local',
        cwd: worktreePath,
        env: expect.objectContaining({ CODEX_HOME: '/managed/codex-home' })
      })
    )
  })

  it('uses the pull-request-fields lane for remote PR generation', async () => {
    const worktreePath = '/remote/repo'
    const params = { agentId: 'custom', model: '', customAgentCommand: 'agent' }
    const context = {
      branch: 'feature/pr-fields',
      base: 'main',
      currentTitle: '',
      currentBody: '',
      currentDraft: false,
      commitSummary: '- feat: add PR fields',
      changeSummary: 'M\tREADME.md',
      patch: '+hello'
    }
    const provider = {
      exec: vi.fn(),
      executeCommitMessagePlan: vi.fn().mockResolvedValue({
        stdout: '{"base":"main","title":"Update README","body":"","draft":false}',
        stderr: '',
        exitCode: 0,
        timedOut: false
      })
    }
    mocks.resolveCommitMessageSettings.mockReturnValue({ ok: true, params })
    mocks.getSshGitProvider.mockReturnValue(provider)
    mocks.getPullRequestDraftContext.mockResolvedValue(context)
    mocks.generatePullRequestFieldsFromContext.mockResolvedValue({
      success: true,
      fields: { base: 'main', title: 'Update README', body: '', draft: false }
    })
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree(worktreePath),
        connectionId: 'conn-1'
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await expect(
      commands.generateRuntimePullRequestFields('id:wt-1', {
        base: 'main',
        title: '',
        body: '',
        draft: false
      })
    ).resolves.toMatchObject({ success: true })

    const target = mocks.generatePullRequestFieldsFromContext.mock.calls[0]?.[2] as {
      execute: (
        plan: { binary: string; args: string[]; stdinPayload: string | null; label: string },
        cwd: string,
        timeoutMs: number
      ) => Promise<unknown>
    }
    await target.execute(
      { binary: 'agent', args: [], stdinPayload: null, label: 'agent' },
      worktreePath,
      1
    )
    expect(provider.executeCommitMessagePlan).toHaveBeenCalledWith(
      { binary: 'agent', args: [], stdinPayload: null, label: 'agent' },
      worktreePath,
      1,
      'pull-request-fields'
    )
  })

  it('uses the pull-request-fields lane for remote PR generation cancellation', async () => {
    const worktreePath = '/remote/repo'
    const provider = { cancelGenerateCommitMessage: vi.fn().mockResolvedValue(undefined) }
    mocks.getSshGitProvider.mockReturnValue(provider)
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree(worktreePath),
        connectionId: 'conn-1'
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await expect(commands.cancelRuntimeGeneratePullRequestFields('id:wt-1')).resolves.toEqual({
      ok: true
    })

    expect(provider.cancelGenerateCommitMessage).toHaveBeenCalledWith(
      worktreePath,
      'pull-request-fields'
    )
  })
})
