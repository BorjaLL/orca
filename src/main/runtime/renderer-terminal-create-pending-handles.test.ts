import { describe, expect, it } from 'vitest'
import {
  PARKED_TERMINAL_CREATE_HANDLE_CAP,
  RendererTerminalCreatePendingHandles,
  TERMINAL_HANDLE_PENDING_CODE,
  TerminalHandlePendingError
} from './renderer-terminal-create-pending-handles'

describe('RendererTerminalCreatePendingHandles', () => {
  it('parks a handle on its tab and answers lookups in both directions', () => {
    const parked = new RendererTerminalCreatePendingHandles()
    parked.park('tab-1', 'term_a')

    expect(parked.tabIdFor('term_a')).toBe('tab-1')
    expect(parked.tabIdFor('term_other')).toBeNull()
    expect(parked.size).toBe(1)
  })

  it('take unparks exactly once', () => {
    const parked = new RendererTerminalCreatePendingHandles()
    parked.park('tab-1', 'term_a')

    expect(parked.take('tab-1')).toBe('term_a')
    expect(parked.take('tab-1')).toBeNull()
    expect(parked.tabIdFor('term_a')).toBeNull()
    expect(parked.size).toBe(0)
  })

  it('re-parking a tab forgets the earlier handle', () => {
    const parked = new RendererTerminalCreatePendingHandles()
    parked.park('tab-1', 'term_a')
    parked.park('tab-1', 'term_b')

    expect(parked.tabIdFor('term_a')).toBeNull()
    expect(parked.tabIdFor('term_b')).toBe('tab-1')
    expect(parked.size).toBe(1)
  })

  it('evicts the oldest parked handle past the cap', () => {
    const parked = new RendererTerminalCreatePendingHandles()
    for (let i = 0; i <= PARKED_TERMINAL_CREATE_HANDLE_CAP; i += 1) {
      parked.park(`tab-${i}`, `term_${i}`)
    }

    expect(parked.size).toBe(PARKED_TERMINAL_CREATE_HANDLE_CAP)
    expect(parked.tabIdFor('term_0')).toBeNull()
    expect(parked.tabIdFor(`term_${PARKED_TERMINAL_CREATE_HANDLE_CAP}`)).toBe(
      `tab-${PARKED_TERMINAL_CREATE_HANDLE_CAP}`
    )
  })
})

describe('TerminalHandlePendingError', () => {
  it('carries the structured code, the tabId, and recovery steps', () => {
    const error = new TerminalHandlePendingError('term_a', 'tab-1')

    expect(error.code).toBe(TERMINAL_HANDLE_PENDING_CODE)
    expect(error.message).toContain('term_a')
    expect(error.message).toContain('tab-1')
    expect(error.data.tabId).toBe('tab-1')
    expect(error.data.nextSteps.join('\n')).toContain('do not create another terminal')
    expect(error.data.nextSteps.join('\n')).toContain('tab-1')
  })
})
