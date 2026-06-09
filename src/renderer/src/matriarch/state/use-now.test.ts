import { describe, expect, it } from 'vitest'
import { formatAgo } from './use-now'

describe('formatAgo', () => {
  const now = 1_000_000_000
  it('reads "now" within the first few seconds', () => {
    expect(formatAgo(now - 1000, now)).toBe('now')
  })
  it('reads seconds, minutes, hours, days', () => {
    expect(formatAgo(now - 5_000, now)).toBe('5s')
    expect(formatAgo(now - 4 * 60_000, now)).toBe('4m')
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('2h')
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3d')
  })
  it('never goes negative for a future timestamp', () => {
    expect(formatAgo(now + 5000, now)).toBe('now')
  })
})
