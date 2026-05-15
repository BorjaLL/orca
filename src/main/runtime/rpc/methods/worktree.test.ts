import { describe, expect, it, vi } from 'vitest'
import { WORKTREE_METHODS } from './worktree'
import type { RpcContext } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'

describe('worktree RPC methods', () => {
  function findMethod(name: string) {
    const method = WORKTREE_METHODS.find((m) => m.name === name)
    if (!method) {
      throw new Error(`Method not found: ${name}`)
    }
    return method
  }

  async function call(name: string, params: Record<string, unknown>, runtime: OrcaRuntimeService) {
    const method = findMethod(name)
    const parsed = method.params ? method.params.parse(params) : undefined
    return method.handler(parsed, { runtime } as RpcContext)
  }

  it('rejects worktree.create when both parent and no-parent are supplied', async () => {
    const runtime = new OrcaRuntimeService()
    vi.spyOn(runtime, 'createManagedWorktree')

    await expect(
      call(
        'worktree.create',
        {
          repo: 'id:repo-1',
          name: 'child',
          parentWorktree: 'id:parent',
          noParent: true
        },
        runtime
      )
    ).rejects.toThrow('Choose either --parent-worktree or --no-parent, not both.')
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('rejects worktree.set when both parent and no-parent are supplied', async () => {
    const runtime = new OrcaRuntimeService()
    vi.spyOn(runtime, 'updateManagedWorktreeMeta')

    await expect(
      call(
        'worktree.set',
        {
          worktree: 'id:child',
          parentWorktree: 'id:parent',
          noParent: true
        },
        runtime
      )
    ).rejects.toThrow('Choose either --parent-worktree or --no-parent, not both.')
    expect(runtime.updateManagedWorktreeMeta).not.toHaveBeenCalled()
  })
})
