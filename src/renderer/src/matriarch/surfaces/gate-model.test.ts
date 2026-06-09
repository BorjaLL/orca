import { describe, expect, it } from 'vitest'
import {
  applyGateResolution,
  buildGateResolution,
  canResolveGate,
  gateStatusLabel
} from './gate-model'
import type { Gate } from '../backend'

const gate = (o: Partial<Gate> = {}): Gate => ({
  id: 'g1',
  taskId: 't1',
  question: 'Which store?',
  options: ['Redux', 'Zustand'],
  status: 'pending',
  ...o
})

describe('canResolveGate', () => {
  it('is true only for a pending gate', () => {
    expect(canResolveGate(gate({ status: 'pending' }))).toBe(true)
    expect(canResolveGate(gate({ status: 'resolved' }))).toBe(false)
    expect(canResolveGate(gate({ status: 'timeout' }))).toBe(false)
  })
  it('is false for a missing gate', () => {
    expect(canResolveGate(undefined)).toBe(false)
    expect(canResolveGate(null)).toBe(false)
  })
})

describe('buildGateResolution — option mode', () => {
  it('accepts an offered option', () => {
    expect(buildGateResolution(gate(), { mode: 'option', option: 'Zustand' })).toEqual({
      ok: true,
      resolution: 'Zustand'
    })
  })
  it('rejects an option the gate never offered', () => {
    const result = buildGateResolution(gate(), { mode: 'option', option: 'MobX' })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringContaining('not offered') })
  })
})

describe('buildGateResolution — text mode', () => {
  it('accepts non-empty free text, trimmed', () => {
    expect(buildGateResolution(gate(), { mode: 'text', text: '  use Redux  ' })).toEqual({
      ok: true,
      resolution: 'use Redux'
    })
  })
  it('rejects whitespace-only text', () => {
    const result = buildGateResolution(gate(), { mode: 'text', text: '   ' })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'Enter an answer.' })
  })
})

describe('buildGateResolution — terminal gates', () => {
  it('refuses to resolve a non-pending gate, naming the status', () => {
    const result = buildGateResolution(gate({ status: 'resolved' }), {
      mode: 'option',
      option: 'Redux'
    })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringContaining('resolved') })
  })
})

describe('applyGateResolution', () => {
  it('returns a resolved copy without mutating the input', () => {
    const original = gate()
    const next = applyGateResolution(original, 'Zustand', '2026-06-09T10:00:00Z')
    expect(next).toMatchObject({
      status: 'resolved',
      resolution: 'Zustand',
      resolvedAt: '2026-06-09T10:00:00Z'
    })
    // Input untouched.
    expect(original.status).toBe('pending')
    expect(original.resolution).toBeUndefined()
  })
})

describe('gateStatusLabel', () => {
  it('describes each state', () => {
    expect(gateStatusLabel(gate({ status: 'pending' }))).toBe('Awaiting an answer')
    expect(gateStatusLabel(gate({ status: 'resolved', resolution: 'Redux' }))).toBe(
      'Resolved: Redux'
    )
    expect(gateStatusLabel(gate({ status: 'resolved' }))).toBe('Resolved')
    expect(gateStatusLabel(gate({ status: 'timeout' }))).toBe('Timed out')
  })
})
