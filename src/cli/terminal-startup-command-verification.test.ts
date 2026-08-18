import { describe, expect, it } from 'vitest'

import {
  buildStartupCommandProbe,
  describeStartupCommandDropFailure,
  normalizeTerminalTextForMatching,
  terminalTailContainsStartupCommand,
  verifyStartupCommandLatched
} from './terminal-startup-command-verification'

const ESC = '\u001B'

describe('normalizeTerminalTextForMatching', () => {
  it('drops SGR colour runs and OSC title writes', () => {
    expect(normalizeTerminalTextForMatching(`${ESC}[1;32mrun tests${ESC}[0m`)).toBe('runtests')
    expect(normalizeTerminalTextForMatching(`${ESC}]0;orca${ESC}\\run tests`)).toBe('runtests')
  })

  it('drops every whitespace run so hard-wrapped output still matches', () => {
    expect(normalizeTerminalTextForMatching('run  the\n  tests')).toBe('runthetests')
  })
})

describe('terminalTailContainsStartupCommand', () => {
  const command = 'claude "Execute your brief."'

  it('matches the echoed command in a styled prompt', () => {
    const tail = ['orca banner', `${ESC}[2m$${ESC}[0m claude "Execute your brief."`]
    expect(terminalTailContainsStartupCommand(tail, buildStartupCommandProbe(command))).toBe(true)
  })

  it('matches a command the terminal hard-wrapped mid-token', () => {
    const tail = ['$ claude "Execute yo', 'ur brief."']
    expect(terminalTailContainsStartupCommand(tail, buildStartupCommandProbe(command))).toBe(true)
  })

  it('rejects the dropped-command shape: banner plus an empty composer', () => {
    const tail = ['Welcome to Claude Code', '', '> ', '']
    expect(terminalTailContainsStartupCommand(tail, buildStartupCommandProbe(command))).toBe(false)
  })

  it('never matches on an empty probe', () => {
    expect(terminalTailContainsStartupCommand(['anything'], buildStartupCommandProbe('   '))).toBe(
      false
    )
  })
})

describe('buildStartupCommandProbe', () => {
  it('caps the probe so a long command still matches a reflowed tail', () => {
    expect(buildStartupCommandProbe('a'.repeat(200))).toHaveLength(48)
  })
})

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms
    }
  }
}

describe('verifyStartupCommandLatched', () => {
  it('reports latched as soon as the command echoes', async () => {
    const clock = fakeClock()
    const tails = [['banner'], ['banner'], ['banner', '$ codex']]
    const result = await verifyStartupCommandLatched({
      command: 'codex',
      readTail: async () => tails.shift() ?? [],
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 1000,
      pollIntervalMs: 100
    })
    expect(result).toEqual({ latched: true, attempts: 3 })
  })

  it('reports the drop once the budget runs out', async () => {
    const clock = fakeClock()
    const result = await verifyStartupCommandLatched({
      command: 'codex "fix the flaky test"',
      readTail: async () => ['banner', '> '],
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 500,
      pollIntervalMs: 100
    })
    expect(result.latched).toBe(false)
    expect(result.attempts).toBe(6)
  })

  it('still reads once when the caller allows no waiting at all', async () => {
    const clock = fakeClock()
    let reads = 0
    const result = await verifyStartupCommandLatched({
      command: 'codex',
      readTail: async () => {
        reads += 1
        return ['banner']
      },
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 0,
      pollIntervalMs: 100
    })
    expect(reads).toBe(1)
    expect(result).toEqual({ latched: false, attempts: 1 })
  })
})

describe('describeStartupCommandDropFailure', () => {
  it('names the exact recovery command', () => {
    const message = describeStartupCommandDropFailure('term_44260c03', 'Execute your brief.')
    expect(message).toContain('term_44260c03')
    expect(message).toContain(
      'orca terminal send --terminal term_44260c03 --enter --text "Execute your brief."'
    )
  })
})
