import { EventEmitter } from 'events'
import { exec, spawn } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChildProcess from 'child_process'
import type { MethodHandler, RequestContext } from './dispatcher'
import { AgentExecHandler } from './agent-exec-handler'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    exec: vi.fn(),
    spawn: vi.fn()
  }
})

const spawnMock = vi.mocked(spawn)
const execMock = vi.mocked(exec)

type FakeChild = EventEmitter & {
  pid: number
  kill: ReturnType<typeof vi.fn>
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: ReturnType<typeof vi.fn> }
}

function createFakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    kill: vi.fn(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: vi.fn() }
  })
}

function createHandlers(): Map<string, MethodHandler> {
  const handlers = new Map<string, MethodHandler>()
  new AgentExecHandler({
    onRequest: (method: string, handler: MethodHandler): void => {
      handlers.set(method, handler)
    }
  } as never)
  return handlers
}

function requestContext(clientId = 1): RequestContext {
  return { clientId, isStale: () => false }
}

describe('AgentExecHandler operation lanes', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    execMock.mockReset()
  })

  it('cancels only the requested operation lane for a cwd', async () => {
    const commitChild = createFakeChild()
    const pullRequestChild = createFakeChild()
    spawnMock
      .mockReturnValueOnce(commitChild as never)
      .mockReturnValueOnce(pullRequestChild as never)
    const handlers = createHandlers()

    const commitPending = handlers.get('agent.execNonInteractive')!(
      {
        binary: 'agent',
        args: [],
        cwd: '/repo',
        stdin: null,
        timeoutMs: 5_000,
        operation: 'commit-message'
      },
      requestContext()
    )
    const pullRequestPending = handlers.get('agent.execNonInteractive')!(
      {
        binary: 'agent',
        args: [],
        cwd: '/repo',
        stdin: null,
        timeoutMs: 5_000,
        operation: 'pull-request-fields'
      },
      requestContext()
    )

    await expect(
      handlers.get('agent.cancelExec')!(
        { cwd: '/repo', operation: 'pull-request-fields' },
        requestContext()
      )
    ).resolves.toEqual({ canceled: true })

    if (process.platform === 'win32') {
      expect(execMock).toHaveBeenCalledTimes(1)
    } else {
      expect(commitChild.kill).not.toHaveBeenCalled()
      expect(pullRequestChild.kill).toHaveBeenCalledWith('SIGKILL')
    }

    pullRequestChild.emit('close', null)
    commitChild.stdout.emit('data', Buffer.from('Commit message'))
    commitChild.emit('close', 0)

    await expect(pullRequestPending).resolves.toMatchObject({
      exitCode: null,
      canceled: true
    })
    await expect(commitPending).resolves.toMatchObject({
      stdout: 'Commit message',
      exitCode: 0,
      canceled: false
    })
  })

  it('rejects duplicate execs in the same cwd and operation lane', async () => {
    const child = createFakeChild()
    spawnMock.mockReturnValue(child as never)
    const handlers = createHandlers()

    const pending = handlers.get('agent.execNonInteractive')!(
      {
        binary: 'agent',
        args: [],
        cwd: '/repo',
        stdin: null,
        timeoutMs: 5_000,
        operation: 'commit-message'
      },
      requestContext()
    )

    await expect(
      handlers.get('agent.execNonInteractive')!(
        {
          binary: 'agent',
          args: [],
          cwd: '/repo',
          stdin: null,
          timeoutMs: 5_000,
          operation: 'commit-message'
        },
        requestContext()
      )
    ).resolves.toMatchObject({
      spawnError: 'Agent exec already running for this worktree and operation.'
    })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    await expect(
      handlers.get('agent.cancelExec')!(
        { cwd: '/repo', operation: 'commit-message' },
        requestContext()
      )
    ).resolves.toEqual({ canceled: true })

    child.emit('close', null)
    await expect(pending).resolves.toMatchObject({ canceled: true })
  })
})
