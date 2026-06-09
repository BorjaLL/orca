import { describe, expect, it } from 'vitest'
import { formatTimestampAbsolute, formatTimestampAgo, shortTaskId } from './task-card-format'

describe('shortTaskId', () => {
  it('strips the task_ prefix and shortens git-style', () => {
    expect(shortTaskId('task_89b2cceccaa5')).toBe('#89b2cce')
  })

  it('handles ids without the task_ prefix', () => {
    expect(shortTaskId('abcdef0123456')).toBe('#abcdef0')
  })

  it('leaves an already-short id intact', () => {
    expect(shortTaskId('task_abc')).toBe('#abc')
  })
})

describe('formatTimestampAgo', () => {
  const now = Date.parse('2026-05-31T00:00:00.000Z')

  it('humanizes an ISO timestamp relative to now', () => {
    expect(formatTimestampAgo('2026-05-29T00:00:00.000Z', now)).toBe('2d ago')
    expect(formatTimestampAgo('2026-05-30T22:00:00.000Z', now)).toBe('2h ago')
  })

  it('says "just now" for sub-3s deltas', () => {
    expect(formatTimestampAgo('2026-05-31T00:00:00.000Z', now)).toBe('just now')
  })

  it('returns empty string for missing or unparseable input', () => {
    expect(formatTimestampAgo(undefined, now)).toBe('')
    expect(formatTimestampAgo('not-a-date', now)).toBe('')
  })
})

describe('formatTimestampAbsolute', () => {
  it('returns a non-empty locale string for a valid timestamp', () => {
    expect(formatTimestampAbsolute('2026-05-29T21:59:28.308Z').length).toBeGreaterThan(0)
  })

  it('returns empty string for missing or unparseable input', () => {
    expect(formatTimestampAbsolute(undefined)).toBe('')
    expect(formatTimestampAbsolute('nope')).toBe('')
  })
})
