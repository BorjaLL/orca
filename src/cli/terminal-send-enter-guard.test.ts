import { describe, expect, it } from 'vitest'

import {
  describeMissingEnterWarning,
  looksLikeSubmittableInstruction
} from './terminal-send-enter-guard'

describe('looksLikeSubmittableInstruction', () => {
  it('treats multi-word text as an instruction', () => {
    expect(looksLikeSubmittableInstruction('Execute your brief.')).toBe(true)
    expect(looksLikeSubmittableInstruction('run the tests')).toBe(true)
  })

  it('treats a long single token as an instruction', () => {
    expect(looksLikeSubmittableInstruction('/some/very/long/path/to/a/brief.md')).toBe(true)
  })

  it('leaves keystroke answers alone', () => {
    expect(looksLikeSubmittableInstruction('y')).toBe(false)
    expect(looksLikeSubmittableInstruction('q')).toBe(false)
    expect(looksLikeSubmittableInstruction('2')).toBe(false)
    expect(looksLikeSubmittableInstruction('')).toBe(false)
    expect(looksLikeSubmittableInstruction('   ')).toBe(false)
  })

  it('leaves control-only payloads alone', () => {
    expect(looksLikeSubmittableInstruction('\u0003')).toBe(false)
    expect(looksLikeSubmittableInstruction('\u001B[A')).toBe(false)
    expect(looksLikeSubmittableInstruction('\n')).toBe(false)
  })
})

describe('describeMissingEnterWarning', () => {
  const handle = 'term_44260c03'

  it('warns when an instruction is pasted without --enter', () => {
    const warning = describeMissingEnterWarning({
      handle,
      text: 'Execute your brief.',
      enter: false,
      interrupt: false
    })
    expect(warning).toContain(handle)
    expect(warning).toContain('--enter')
  })

  it('stays silent when the send submits', () => {
    expect(
      describeMissingEnterWarning({
        handle,
        text: 'Execute your brief.',
        enter: true,
        interrupt: false
      })
    ).toBeNull()
  })

  it('stays silent for an interrupt', () => {
    expect(
      describeMissingEnterWarning({
        handle,
        text: 'anything at all',
        enter: false,
        interrupt: true
      })
    ).toBeNull()
  })

  it('stays silent when no text was sent', () => {
    expect(describeMissingEnterWarning({ handle, enter: false, interrupt: false })).toBeNull()
  })

  it('stays silent for a keystroke answer', () => {
    expect(describeMissingEnterWarning({ handle, text: 'y', enter: false, interrupt: false })).toBe(
      null
    )
  })
})
