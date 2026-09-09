import type {
  RuntimeTerminalClose,
  RuntimeTerminalCreate,
  RuntimeTerminalFocus,
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeTerminalRename,
  RuntimeTerminalSend,
  RuntimeTerminalShow,
  RuntimeTerminalSplit,
  RuntimeTerminalWait
} from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { shouldUseRendererBackedInteractiveTerminal } from '../codex-command-classification'
import {
  formatTerminalClose,
  formatTerminalCreate,
  formatTerminalFocus,
  formatTerminalList,
  formatTerminalRead,
  formatTerminalRename,
  formatTerminalSend,
  formatTerminalShow,
  formatTerminalSplit,
  formatTerminalWait,
  printResult
} from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import {
  getBrowserWorktreeSelector,
  getOptionalWorktreeSelector,
  getRequiredWorktreeSelector,
  getTerminalHandle
} from '../selectors'
import { describeMissingEnterWarning } from '../terminal-send-enter-guard'
import {
  describeStartupCommandDropFailure,
  verifyStartupCommandLatched
} from '../terminal-startup-command-verification'

// Why: terminal wait legitimately needs to outlive the CLI's default RPC
// timeout. Even without an explicit server timeout, the client must allow
// long waits instead of failing at the generic 15s transport cap.
const DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS = 5 * 60 * 1000

// Why: verification reads the tail repeatedly; a short poll keeps a latched
// command's confirmation fast without hammering the runtime on a dropped one.
const STARTUP_COMMAND_VERIFY_POLL_INTERVAL_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type StartupCommandVerificationClient = {
  call: <TResult>(method: string, params?: unknown) => Promise<{ result: TResult }>
}

/**
 * Proves the startup command actually reached the terminal, and optionally
 * repairs a drop by resending it. `terminal create` returns as soon as the tab
 * exists, so without this a dropped command is indistinguishable from a working
 * one: same handle, same "created" line, an idle shell underneath.
 */
export async function annotateStartupCommandVerification(args: {
  client: StartupCommandVerificationClient
  command: string
  recover: boolean
  terminal: RuntimeTerminalCreate
  timeoutMs?: number
  pollIntervalMs?: number
  sleepFn?: (ms: number) => Promise<void>
  nowFn?: () => number
}): Promise<void> {
  const handle = args.terminal.handle
  const pollIntervalMs = args.pollIntervalMs ?? STARTUP_COMMAND_VERIFY_POLL_INTERVAL_MS
  const probe = {
    command: args.command,
    readTail: async (): Promise<string[]> => {
      try {
        const read = await args.client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
          terminal: handle
        })
        return read.result.terminal.tail
      } catch (error) {
        // Why: a parked handle (orca-tracker-er7) fails reads until its PTY
        // binds; keep polling instead of turning a pending handle into an
        // ok:false create.
        if (error instanceof RuntimeClientError && error.code === 'terminal_handle_pending') {
          return []
        }
        throw error
      }
    },
    sleep: args.sleepFn ?? sleep,
    now: args.nowFn ?? Date.now,
    pollIntervalMs,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  }

  const first = await verifyStartupCommandLatched(probe)
  if (first.latched || !args.recover) {
    args.terminal.startupCommandVerification = {
      requested: true,
      latched: first.latched,
      attempts: first.attempts
    }
    return
  }

  // Why: this is the manual recovery the fleet already runs by hand after a
  // silent drop; doing it here is what turns "create or fail" into "create".
  await args.client.call('terminal.send', {
    terminal: handle,
    text: args.command,
    enter: true,
    interrupt: false,
    agentPrompt: true,
    client: { id: 'orca-cli', type: 'desktop' }
  })
  const second = await verifyStartupCommandLatched(probe)
  args.terminal.startupCommandVerification = {
    requested: true,
    latched: second.latched,
    attempts: first.attempts + second.attempts,
    recovered: second.latched
  }
}

const terminalFocusHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const result = await client.call<{ focus: RuntimeTerminalFocus }>('terminal.focus', {
    terminal: await getTerminalHandle(flags, cwd, client),
    navigation: 'host'
  })
  printResult(result, json, formatTerminalFocus)
}

export const TERMINAL_HANDLERS: Record<string, CommandHandler> = {
  'terminal list': async ({ flags, client, cwd, json }) => {
    const result = await client.call<RuntimeTerminalListResult>('terminal.list', {
      worktree: await getOptionalWorktreeSelector(flags, 'worktree', cwd, client),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
      // Why: agent JSON calls dominate; topology stays available through an explicit opt-in.
      includeVisualLayouts: !json || flags.has('include-visual-layouts')
    })
    printResult(result, json, formatTerminalList)
  },
  'terminal show': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ terminal: RuntimeTerminalShow }>('terminal.show', {
      terminal: await getTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, formatTerminalShow)
  },
  'terminal read': async ({ flags, client, cwd, json }) => {
    const cursorFlag = getOptionalStringFlag(flags, 'cursor')
    const cursor =
      cursorFlag !== undefined && /^\d+$/.test(cursorFlag)
        ? Number.parseInt(cursorFlag, 10)
        : undefined
    if (cursorFlag !== undefined && cursor === undefined) {
      throw new RuntimeClientError('invalid_argument', '--cursor must be a non-negative integer')
    }
    const result = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
      terminal: await getTerminalHandle(flags, cwd, client),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatTerminalRead)
  },
  'terminal send': async ({ flags, client, cwd, json }) => {
    const text = getOptionalStringFlag(flags, 'text')
    const enter = flags.get('enter') === true
    const interrupt = flags.get('interrupt') === true
    const handle = await getTerminalHandle(flags, cwd, client)
    const result = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
      terminal: handle,
      text,
      enter,
      interrupt,
      ...(text && enter && !interrupt ? { agentPrompt: true } : {}),
      client: { id: 'orca-cli', type: 'desktop' }
    })
    printResult(result, json, formatTerminalSend)
    // Why: an unsubmitted paste still reports "sent", so the caller has no
    // signal that its instruction is parked in the composer. Warn on stderr so
    // --json output stays parseable.
    const missingEnterWarning = describeMissingEnterWarning({ handle, text, enter, interrupt })
    if (missingEnterWarning) {
      console.error(missingEnterWarning)
    }
  },
  'terminal wait': async ({ flags, client, cwd, json }) => {
    const timeoutMs = getOptionalPositiveIntegerFlag(flags, 'timeout-ms')
    const result = await client.call<{ wait: RuntimeTerminalWait }>(
      'terminal.wait',
      {
        terminal: await getTerminalHandle(flags, cwd, client),
        for: getRequiredStringFlag(flags, 'for'),
        timeoutMs
      },
      {
        timeoutMs: timeoutMs ? timeoutMs + 5000 : DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS
      }
    )
    printResult(result, json, formatTerminalWait)
    if (result.result.wait.satisfied === false) {
      // Why: callers commonly chain `terminal wait && terminal send`; a
      // structured blocked result is still an unsatisfied wait condition.
      process.exitCode = 1
    }
  },
  'terminal stop': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ stopped: number }>('terminal.stop', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    })
    printResult(result, json, (value) => `Stopped ${value.stopped} terminals.`)
  },
  'terminal rename': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ rename: RuntimeTerminalRename }>('terminal.rename', {
      terminal: await getTerminalHandle(flags, cwd, client),
      title: getOptionalStringFlag(flags, 'title') ?? null
    })
    printResult(result, json, formatTerminalRename)
  },
  'terminal create': async ({ flags, client, cwd, json }) => {
    if (client.isRemote && !flags.has('worktree')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Remote terminal create requires --worktree because the client cwd cannot identify a server worktree.'
      )
    }
    const command = getOptionalStringFlag(flags, 'command')
    const verifyCommand = flags.get('verify-command') === true
    const recoverCommand = flags.get('recover-command') === true
    if ((verifyCommand || recoverCommand) && command === undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--verify-command and --recover-command require --command'
      )
    }
    const useRendererBackedInteractiveTerminal =
      !client.isRemote && shouldUseRendererBackedInteractiveTerminal(command)
    const focus = flags.get('focus') === true
    const result = await client.call<{ terminal: RuntimeTerminalCreate }>('terminal.create', {
      worktree: await getBrowserWorktreeSelector(flags, cwd, client),
      command,
      title: getOptionalStringFlag(flags, 'title'),
      // Why: interactive local agent TUIs need the renderer-backed terminal
      // path for browser-side features, but CLI creates must stay backgrounded
      // unless the caller explicitly asks for focus.
      focus,
      ...(focus ? { presentation: 'focused' } : {}),
      ...(useRendererBackedInteractiveTerminal ? { rendererBacked: true, activate: focus } : {})
    })
    if (command !== undefined && (verifyCommand || recoverCommand)) {
      await annotateStartupCommandVerification({
        client,
        command,
        recover: recoverCommand,
        terminal: result.result.terminal,
        timeoutMs: getOptionalPositiveIntegerFlag(flags, 'verify-timeout-ms')
      })
    }
    printResult(result, json, formatTerminalCreate)
    if (result.result.terminal.startupCommandVerification?.latched === false) {
      console.error(describeStartupCommandDropFailure(result.result.terminal.handle, command ?? ''))
      // Why: a create whose command never latched produced an idle tab, which is
      // a failed create for every caller that asked for a command.
      process.exitCode = 1
    }
  },
  // `focus` resolves to this canonical path via CommandSpec.aliases before dispatch.
  'terminal switch': terminalFocusHandler,
  'terminal close': async ({ flags, client, cwd, json }) => {
    const method = flags.get('tab') === true ? 'terminal.closeTab' : 'terminal.close'
    const result = await client.call<{ close: RuntimeTerminalClose }>(method, {
      terminal: await getTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, formatTerminalClose)
  },
  'terminal split': async ({ flags, client, cwd, json }) => {
    const directionFlag = getOptionalStringFlag(flags, 'direction')
    if (
      directionFlag !== undefined &&
      directionFlag !== 'horizontal' &&
      directionFlag !== 'vertical'
    ) {
      throw new RuntimeClientError('invalid_argument', '--direction must be horizontal or vertical')
    }
    const result = await client.call<{ split: RuntimeTerminalSplit }>('terminal.split', {
      terminal: await getTerminalHandle(flags, cwd, client),
      direction: directionFlag,
      command: getOptionalStringFlag(flags, 'command')
    })
    printResult(result, json, formatTerminalSplit)
  }
}
