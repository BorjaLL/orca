import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_HANDLERS } from './terminal'
import type { HandlerContext } from '../dispatch'

function makeCtx(
  flags: Record<string, string | boolean>,
  call: ReturnType<typeof vi.fn>
): HandlerContext {
  return {
    flags: new Map<string, string | boolean>(Object.entries(flags)),
    client: { call, isRemote: false } as unknown as HandlerContext['client'],
    cwd: '/tmp',
    json: true
  }
}

describe('orca terminal note', () => {
  it('sets the note on the resolved terminal', async () => {
    const call = vi.fn(async () => ({ note: { handle: 'term_1', note: 'reworking the board' } }))
    await TERMINAL_HANDLERS['terminal note'](
      makeCtx({ terminal: 'term_1', note: 'reworking the board' }, call)
    )
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('terminal.setNote', {
      terminal: 'term_1',
      note: 'reworking the board'
    })
  })

  it('clears the note when no text is given', async () => {
    const call = vi.fn(async () => ({ note: { handle: 'term_1', note: '' } }))
    await TERMINAL_HANDLERS['terminal note'](makeCtx({ terminal: 'term_1' }, call))
    expect(call).toHaveBeenCalledWith('terminal.setNote', { terminal: 'term_1', note: '' })
  })
})
