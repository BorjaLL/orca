import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  createAgentInterruptInference,
  isCtrlCKeyEvent,
  isPlainEscapeKeyEvent
} from './agent-interrupt-inference'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function makeEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'write tests',
    updatedAt: 1_000,
    stateStartedAt: 900,
    agentType: 'codex',
    paneKey: PANE_KEY,
    terminalTitle: 'Codex',
    stateHistory: [],
    ...overrides
  }
}

describe('agent interrupt inference', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['claude', 'codex', 'opencode'] as const)(
    'emits a strict baseline request for %s plain Escape',
    (agentType) => {
      vi.useFakeTimers()
      let entry: AgentStatusEntry | undefined = makeEntry({ agentType })
      const inferInterrupt = vi.fn()
      const tracker = createAgentInterruptInference({
        paneKey: PANE_KEY,
        getStatusEntry: () => entry,
        inferInterrupt,
        now: () => 1_100
      })

      tracker.observeInputIntent('plain-escape')
      vi.advanceTimersByTime(499)
      expect(inferInterrupt).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(inferInterrupt).toHaveBeenCalledWith({
        paneKey: PANE_KEY,
        baselineUpdatedAt: 1_000,
        baselineStateStartedAt: 900,
        baselinePrompt: 'write tests',
        baselineAgentType: agentType,
        intent: 'plain-escape'
      })
      tracker.dispose()
      entry = undefined
    }
  )

  it('does not emit for unsupported agents or non-working states', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: 'gemini' })
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = makeEntry({ state: 'waiting', agentType: 'codex' })
    tracker.observeInputIntent('plain-escape')
    vi.runOnlyPendingTimers()

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('cancels when a newer hook update arrives during the settle window', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = makeEntry({ updatedAt: 1_001 })
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('cancels when the status disappears during the settle window', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = undefined
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('emits a Claude-only inferred interrupt for rapid double Ctrl+C', () => {
    vi.useFakeTimers()
    let currentNow = 1_100
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => makeEntry({ agentType: 'claude' }),
      inferInterrupt,
      now: () => currentNow
    })

    tracker.observeInputIntent('ctrl-c')
    currentNow += 120
    tracker.observeInputIntent('ctrl-c')
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineAgentType: 'claude',
        intent: 'double-ctrl-c'
      })
    )
    tracker.dispose()
  })

  it('does not infer double Ctrl+C for Codex', () => {
    vi.useFakeTimers()
    let currentNow = 1_100
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => makeEntry({ agentType: 'codex' }),
      inferInterrupt,
      now: () => currentNow
    })

    tracker.observeInputIntent('ctrl-c')
    currentNow += 120
    tracker.observeInputIntent('ctrl-c')
    vi.runOnlyPendingTimers()

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('requires exact plain Escape key events', () => {
    expect(
      isPlainEscapeKeyEvent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      isPlainEscapeKeyEvent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        altKey: true,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
    expect(
      isPlainEscapeKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
    expect(
      isCtrlCKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      isCtrlCKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
  })
})
