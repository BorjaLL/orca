import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeRpcFailureError } from '../runtime-client'
import { parseArgs } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

describe('terminal close CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the default close RPC unchanged', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { close: { handle: 'term-1', tabId: 'tab-1', ptyKilled: true } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([['terminal', 'term-1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.close', { terminal: 'term-1' })
  })

  it('routes --tab to the durable whole-tab RPC', async () => {
    const parsed = parseArgs(['terminal', 'close', '--terminal', 'term-1', '--tab'])
    const call = vi.fn().mockResolvedValue({
      result: {
        close: {
          handle: 'term-1',
          tabId: 'tab-1',
          closeMode: 'tab',
          ptyKilled: false
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: parsed.flags,
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(parsed.flags.get('tab')).toBe(true)
    expect(call).toHaveBeenCalledWith('terminal.closeTab', { terminal: 'term-1' })
  })

  it('documents that --tab waits for durable persistence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'close'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('orca terminal close [--terminal <handle>] [--tab] [--json]')
    expect(help).toContain('durable persistence')
  })
})

describe('terminal send CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks combined text and Enter as an agent prompt candidate', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 7 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text', 'review'],
        ['enter', true]
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term-1',
      text: 'review',
      enter: true,
      interrupt: false,
      agentPrompt: true,
      client: { id: 'orca-cli', type: 'desktop' }
    })
  })

  it('keeps text-only and bare Enter sends as direct terminal input', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 1 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text', 'x']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })
    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['enter', true]
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenNthCalledWith(1, 'terminal.send', {
      terminal: 'term-1',
      text: 'x',
      enter: false,
      interrupt: false,
      client: { id: 'orca-cli', type: 'desktop' }
    })
    expect(call).toHaveBeenNthCalledWith(2, 'terminal.send', {
      terminal: 'term-1',
      text: undefined,
      enter: true,
      interrupt: false,
      client: { id: 'orca-cli', type: 'desktop' }
    })
  })
})

describe('terminal send missing-enter guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns when an instruction is pasted without --enter', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 19 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text', 'Execute your brief.']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(String(error.mock.calls[0]?.[0])).toContain('not submitted (no --enter)')
  })

  it('stays quiet when the send submits', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 19 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text', 'Execute your brief.'],
        ['enter', true]
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(error).not.toHaveBeenCalled()
  })
})

describe('terminal create startup command verification', () => {
  const previousExitCode = process.exitCode

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = previousExitCode
  })

  function createClient(tailsByCall: string[][]): ReturnType<typeof vi.fn> {
    let reads = 0
    return vi.fn(async (method: string) => {
      if (method === 'terminal.create') {
        return {
          result: { terminal: { handle: 'term-1', worktreeId: 'wt-1', title: null } }
        }
      }
      if (method === 'terminal.read') {
        const tail = tailsByCall[Math.min(reads, tailsByCall.length - 1)] ?? []
        reads += 1
        return { result: { terminal: { handle: 'term-1', status: 'running', tail } } }
      }
      return { result: { send: { handle: 'term-1', accepted: true, bytesWritten: 5 } } }
    })
  }

  function createFlags(extra: [string, string | true][]): Map<string, string | true> {
    return new Map<string, string | true>([
      ['worktree', 'path:/tmp/worktree'],
      ['command', 'codex "fix the flaky test"'],
      ['verify-timeout-ms', '1'],
      ...extra
    ])
  }

  it('confirms a latched command without touching the exit code', async () => {
    const call = createClient([['$ codex "fix the flaky test"']])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await TERMINAL_HANDLERS['terminal create']({
      flags: createFlags([['verify-command', true]]),
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(log.mock.calls[0]?.[0])).toContain('startup command: confirmed')
    expect(process.exitCode).toBe(0)
  })

  it('fails loudly when the command never reached the terminal', async () => {
    const call = createClient([['Welcome to Codex', '> ']])
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0

    await TERMINAL_HANDLERS['terminal create']({
      flags: createFlags([['verify-command', true]]),
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(error.mock.calls[0]?.[0])).toContain(
      'orca terminal send --terminal term-1 --enter'
    )
    expect(process.exitCode).toBe(1)
  })

  it('resends a dropped command with --recover-command and reports the repair', async () => {
    const call = createClient([['Welcome to Codex', '> '], ['$ codex "fix the flaky test"']])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await TERMINAL_HANDLERS['terminal create']({
      flags: createFlags([['recover-command', true]]),
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({
        terminal: 'term-1',
        text: 'codex "fix the flaky test"',
        enter: true
      })
    )
    expect(String(log.mock.calls[0]?.[0])).toContain('dropped by create, resent and confirmed')
    expect(process.exitCode).toBe(0)
  })

  // orca-tracker-er7: a parked terminal-create handle fails terminal.read with
  // terminal_handle_pending until it binds. Verification must keep polling
  // through that, not surface it as a failed create.
  it('keeps polling through a pending handle and still confirms once it binds', async () => {
    let reads = 0
    const call = vi.fn(async (method: string) => {
      if (method === 'terminal.create') {
        return {
          result: {
            terminal: { handle: 'term-1', worktreeId: 'wt-1', title: null, handlePending: true }
          }
        }
      }
      if (method === 'terminal.read') {
        reads += 1
        if (reads === 1) {
          throw new RuntimeRpcFailureError({
            id: 'req_1',
            ok: false,
            error: {
              code: 'terminal_handle_pending',
              message: 'not bound yet',
              data: { tabId: 'tab-1' }
            }
          })
        }
        return {
          result: {
            terminal: {
              handle: 'term-1',
              status: 'running',
              tail: ['$ codex "fix the flaky test"']
            }
          }
        }
      }
      return { result: { send: { handle: 'term-1', accepted: true, bytesWritten: 5 } } }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = 0

    await TERMINAL_HANDLERS['terminal create']({
      flags: createFlags([
        ['verify-command', true],
        ['verify-timeout-ms', '400']
      ]),
      client: { call, isRemote: false } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(reads).toBe(2)
    expect(String(log.mock.calls[0]?.[0])).toContain('startup command: confirmed')
    expect(process.exitCode).toBe(0)
  })

  it('rejects verification without a command to verify', async () => {
    const call = createClient([[]])

    await expect(
      TERMINAL_HANDLERS['terminal create']({
        flags: new Map<string, string | true>([
          ['worktree', 'path:/tmp/worktree'],
          ['verify-command', true]
        ]),
        client: { call, isRemote: false } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: false
      })
    ).rejects.toThrow('--verify-command and --recover-command require --command')
  })
})
