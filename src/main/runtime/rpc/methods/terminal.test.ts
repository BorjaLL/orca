import { describe, expect, it } from 'vitest'
import { TERMINAL_METHODS } from './terminal'

describe('terminal RPC methods', () => {
  function findMethod(name: string) {
    const method = TERMINAL_METHODS.find((m) => m.name === name)
    if (!method) {
      throw new Error(`Method not found: ${name}`)
    }
    return method
  }

  it('registers terminal.setNote alongside terminal.list', () => {
    const names = TERMINAL_METHODS.map((m) => m.name)
    expect(names).toContain('terminal.list')
    expect(names).toContain('terminal.setNote')
  })

  describe('terminal.setNote params', () => {
    const params = () => findMethod('terminal.setNote').params!

    it('accepts a handle + note', () => {
      expect(params().parse({ terminal: 'term_1', note: 'reworking the board' })).toMatchObject({
        terminal: 'term_1',
        note: 'reworking the board'
      })
    })

    it('preserves an empty note (so the agent can clear it)', () => {
      expect(params().parse({ terminal: 'term_1', note: '' })).toMatchObject({
        terminal: 'term_1',
        note: ''
      })
    })

    it('allows an omitted note', () => {
      expect(() => params().parse({ terminal: 'term_1' })).not.toThrow()
    })

    it('requires a terminal handle', () => {
      expect(() => params().parse({ note: 'x' })).toThrow()
    })
  })
})
