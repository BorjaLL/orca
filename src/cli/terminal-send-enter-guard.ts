/**
 * Why: `terminal send --text "..."` without `--enter` pastes the text into the
 * composer and never submits it. The call still reports success, so a caller
 * that meant to give an agent an instruction sees "sent" and waits on a prompt
 * that was never submitted. This guard makes that shape audible.
 */

/** Below this length a lone token reads as a keystroke answer (y, q, 1), not an instruction. */
const INSTRUCTION_LENGTH_THRESHOLD = 24

// Why: control-only payloads are deliberate keystrokes (Ctrl-C, arrow keys, a
// bare newline); submitting them is the caller's business, not ours.
function isControlOnly(text: string): boolean {
  if (text.length === 0) {
    return false
  }
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x1f && code !== 0x7f) {
      return false
    }
  }
  return true
}

/**
 * True when the text reads as an instruction meant for an agent rather than a
 * keystroke: more than one word, or long enough that nobody typed it as an
 * answer to a prompt.
 */
export function looksLikeSubmittableInstruction(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || isControlOnly(text)) {
    return false
  }
  return /\s/.test(trimmed) || trimmed.length >= INSTRUCTION_LENGTH_THRESHOLD
}

export type MissingEnterGuardInput = {
  handle: string
  text?: string
  enter: boolean
  interrupt: boolean
}

/**
 * The warning to print when a send pastes an instruction it never submits, or
 * null when the send is unambiguous.
 */
export function describeMissingEnterWarning(input: MissingEnterGuardInput): string | null {
  if (input.enter || input.interrupt || input.text === undefined) {
    return null
  }
  if (!looksLikeSubmittableInstruction(input.text)) {
    return null
  }
  return [
    `warning: text was pasted into ${input.handle} but not submitted (no --enter).`,
    'It is sitting in the composer unsent. Re-run with --enter to submit it.'
  ].join('\n')
}
