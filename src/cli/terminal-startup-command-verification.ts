/**
 * Why: `terminal create --command` returns as soon as the tab handle exists, well
 * before the startup command is delivered. On the renderer-backed path a create
 * that lands on an already-mounted tab can drop the command entirely, so the
 * caller gets a live handle attached to an idle shell and cannot tell the
 * difference. These helpers let a caller prove the command actually latched.
 */

/** Longest command prefix used as the match probe; wrapped/reflowed tails stay matchable. */
const MAX_PROBE_LENGTH = 48

export const DEFAULT_STARTUP_COMMAND_VERIFY_TIMEOUT_MS = 8000
export const DEFAULT_STARTUP_COMMAND_VERIFY_POLL_INTERVAL_MS = 250

export type StartupCommandVerification = {
  requested: true
  latched: boolean
  attempts: number
  recovered?: boolean
}

// Why: terminal tails carry SGR colour runs and OSC title writes; matching raw
// text against them fails on every styled prompt. Built from escape constants
// rather than a literal so the pattern stays readable and lint-clean.
const ESC = String.fromCodePoint(0x1b)
const BEL = String.fromCodePoint(0x07)
const ANSI_PATTERN = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[[\\]()#;?]*[0-9;]*[A-Za-z]`,
  'g'
)

/**
 * Collapses a terminal tail (or a command) to a comparable form: escape
 * sequences removed, every whitespace run dropped, lowercased. Dropping
 * whitespace outright is what makes a hard-wrapped command line match the
 * command that produced it.
 */
export function normalizeTerminalTextForMatching(text: string): string {
  return text.replaceAll(ANSI_PATTERN, '').replaceAll(/\s+/g, '').toLowerCase()
}

/** The command prefix a latched startup command must echo somewhere in the tail. */
export function buildStartupCommandProbe(command: string): string {
  return normalizeTerminalTextForMatching(command).slice(0, MAX_PROBE_LENGTH)
}

export function terminalTailContainsStartupCommand(tail: string[], probe: string): boolean {
  if (probe.length === 0) {
    return false
  }
  return normalizeTerminalTextForMatching(tail.join('\n')).includes(probe)
}

export type VerifyStartupCommandLatchedDeps = {
  command: string
  readTail: () => Promise<string[]>
  sleep: (ms: number) => Promise<void>
  now: () => number
  timeoutMs?: number
  pollIntervalMs?: number
}

/**
 * Polls the terminal tail until the startup command echoes, or the budget runs
 * out. Always makes at least one read so a zero timeout still reports a verdict
 * instead of an unproven `false`.
 */
export async function verifyStartupCommandLatched(
  deps: VerifyStartupCommandLatchedDeps
): Promise<{ latched: boolean; attempts: number }> {
  const probe = buildStartupCommandProbe(deps.command)
  const timeoutMs = deps.timeoutMs ?? DEFAULT_STARTUP_COMMAND_VERIFY_TIMEOUT_MS
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_STARTUP_COMMAND_VERIFY_POLL_INTERVAL_MS
  const deadline = deps.now() + timeoutMs
  let attempts = 0
  for (;;) {
    attempts += 1
    const tail = await deps.readTail()
    if (terminalTailContainsStartupCommand(tail, probe)) {
      return { latched: true, attempts }
    }
    if (deps.now() + pollIntervalMs > deadline) {
      return { latched: false, attempts }
    }
    await deps.sleep(pollIntervalMs)
  }
}

/** The operator-facing failure, naming the manual recovery the fleet already uses by hand. */
export function describeStartupCommandDropFailure(handle: string, command: string): string {
  return [
    `warning: terminal ${handle} was created but its startup command never appeared in the terminal.`,
    'The tab is live and idle; the command was dropped, not queued.',
    `Recover with: orca terminal send --terminal ${handle} --enter --text ${JSON.stringify(command)}`
  ].join('\n')
}
