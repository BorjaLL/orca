// OTLP encoder tests. Network roundtrip is not exercised here — the
// `postJson` path is a thin Node http wrapper and is best left to integration
// tests against a real LGTM container. This suite locks the wire encoding.

import { describe, expect, it } from 'vitest'
import { _internalsForTests, createOtlpExporterFromEnv } from './otlp-exporter'
import type { RedactableSpan } from './redactor'

const { encodeOtlpPayload, toOtlpAttributes, spanKindToOtlp } = _internalsForTests

function span(overrides: Partial<RedactableSpan> = {}): RedactableSpan {
  return {
    name: 'unit',
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    kind: 'internal',
    startTimeUnixNano: '1000',
    endTimeUnixNano: '2000',
    durationMs: 1.0,
    attributes: {},
    events: [],
    exit: { _tag: 'Success' },
    ...overrides
  }
}

describe('otlp-exporter — env gating', () => {
  it('returns null when ORCA_OTLP_TRACES_URL is unset', () => {
    const before = process.env.ORCA_OTLP_TRACES_URL
    delete process.env.ORCA_OTLP_TRACES_URL
    expect(createOtlpExporterFromEnv()).toBeNull()
    if (before !== undefined) {
      process.env.ORCA_OTLP_TRACES_URL = before
    }
  })
})

describe('otlp-exporter — attribute encoding', () => {
  it('encodes strings, ints, floats, bools', () => {
    const out = toOtlpAttributes({ s: 'x', i: 5, f: 1.5, b: true })
    expect(out).toEqual([
      { key: 's', value: { stringValue: 'x' } },
      { key: 'i', value: { intValue: '5' } },
      { key: 'f', value: { doubleValue: 1.5 } },
      { key: 'b', value: { boolValue: true } }
    ])
  })
  it('JSON-encodes objects and arrays', () => {
    const out = toOtlpAttributes({ list: [1, 2], obj: { a: 1 } })
    expect(out).toContainEqual({ key: 'list', value: { stringValue: '[1,2]' } })
    expect(out).toContainEqual({ key: 'obj', value: { stringValue: '{"a":1}' } })
  })
  it('drops null/undefined', () => {
    const out = toOtlpAttributes({ keep: 'x', drop: null, alsodrop: undefined })
    expect(out.find((kv) => kv.key === 'drop')).toBeUndefined()
    expect(out.find((kv) => kv.key === 'alsodrop')).toBeUndefined()
    expect(out.find((kv) => kv.key === 'keep')).toBeDefined()
  })
})

describe('otlp-exporter — span kind mapping', () => {
  it('maps OTel SpanKind names to numeric codes', () => {
    expect(spanKindToOtlp('internal')).toBe(1)
    expect(spanKindToOtlp('server')).toBe(2)
    expect(spanKindToOtlp('client')).toBe(3)
    expect(spanKindToOtlp('producer')).toBe(4)
    expect(spanKindToOtlp('consumer')).toBe(5)
    expect(spanKindToOtlp('unknown')).toBe(1)
  })
})

describe('otlp-exporter — payload encoding', () => {
  it('builds a valid OTLP payload skeleton with service.name', () => {
    const out = encodeOtlpPayload('orca-test', [span()])
    expect(out.resourceSpans).toHaveLength(1)
    expect(out.resourceSpans[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'orca-test' }
    })
    expect(out.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1)
  })

  it('includes parentSpanId when present', () => {
    const out = encodeOtlpPayload('s', [span({ parentSpanId: 'p'.repeat(16) })])
    const s = out.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.parentSpanId).toBe('p'.repeat(16))
  })

  it('omits parentSpanId for root spans', () => {
    const out = encodeOtlpPayload('s', [span()])
    const s = out.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.parentSpanId).toBeUndefined()
  })

  it('sets ERROR status on Failure exits', () => {
    const out = encodeOtlpPayload('s', [span({ exit: { _tag: 'Failure', cause: 'boom' } })])
    const s = out.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.status?.code).toBe(2)
    expect(s.status?.message).toBe('boom')
  })

  it('omits status for Success exits', () => {
    const out = encodeOtlpPayload('s', [span()])
    const s = out.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.status).toBeUndefined()
  })

  it('encodes events with their attributes', () => {
    const out = encodeOtlpPayload('s', [
      span({
        events: [{ name: 'log', timeUnixNano: '1500', attributes: { msg: 'hi' } }]
      })
    ])
    const s = out.resourceSpans[0].scopeSpans[0].spans[0]
    expect(s.events).toHaveLength(1)
    expect(s.events[0].name).toBe('log')
    expect(s.events[0].timeUnixNano).toBe('1500')
    expect(s.events[0].attributes).toContainEqual({
      key: 'msg',
      value: { stringValue: 'hi' }
    })
  })
})
