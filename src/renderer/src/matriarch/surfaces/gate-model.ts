// Pure logic for the R2 "answer a decision gate" interaction (PRD FR25 / Story
// 6.1). Kept free of React + IO so the validation, the resolution payload, and
// the can-resolve guard are directly unit-testable — the same extract-and-test
// pattern as board-model / inbox-model / needs-attention. The detail Sheet's
// gate affordance renders over these; the Orca adapter sends the resolution via
// orchestration.gateResolve (a real existing RPC), the mock applies it locally.

import type { Gate } from '../backend'

/** What the operator is answering a gate with: a listed option, or free text. */
export type GateResolutionInput =
  | { mode: 'option'; option: string }
  | { mode: 'text'; text: string }

export type GateResolutionResult = { ok: true; resolution: string } | { ok: false; reason: string }

/**
 * Only a pending gate can be answered. A resolved/timeout gate is terminal — the
 * UI shows the resolution read-only rather than an answer affordance. Separated
 * out so both the render guard and the action guard agree.
 */
export function canResolveGate(gate: Gate | undefined | null): boolean {
  return !!gate && gate.status === 'pending'
}

/**
 * Validate + normalize an answer into the `resolution` string the backend takes.
 * - option mode: the option must be one of the gate's declared options (no
 *   answering with a value the gate never offered).
 * - text mode: free text must be non-empty after trimming.
 * Returns a typed result so the caller surfaces the reason instead of throwing.
 */
export function buildGateResolution(gate: Gate, input: GateResolutionInput): GateResolutionResult {
  if (!canResolveGate(gate)) {
    return { ok: false, reason: `Gate is ${gate.status}, not pending.` }
  }
  if (input.mode === 'option') {
    if (!gate.options.includes(input.option)) {
      return { ok: false, reason: 'That option is not offered by this gate.' }
    }
    return { ok: true, resolution: input.option }
  }
  const text = input.text.trim()
  if (text.length === 0) {
    return { ok: false, reason: 'Enter an answer.' }
  }
  return { ok: true, resolution: text }
}

/**
 * Apply a resolution to a gate locally (the mock + optimistic UI reconciliation
 * use this; the real backend returns the authoritative row). Pure: returns a new
 * gate, never mutates the input.
 */
export function applyGateResolution(gate: Gate, resolution: string, resolvedAt: string): Gate {
  return { ...gate, status: 'resolved', resolution, resolvedAt }
}

/** A short, human label for a gate's current state, for the read-only display. */
export function gateStatusLabel(gate: Gate): string {
  switch (gate.status) {
    case 'pending':
      return 'Awaiting an answer'
    case 'resolved':
      return gate.resolution ? `Resolved: ${gate.resolution}` : 'Resolved'
    case 'timeout':
      return 'Timed out'
  }
}
