import { useEffect, useState } from 'react'

/**
 * A ticking clock for relative-time labels ("updated 3s ago"). Re-renders the
 * consumer on each tick so freshness stays honest without the data feed itself
 * having to re-emit. Defaults to 1s — fine for a monitor's freshness chip.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Compact relative-time label, e.g. "now", "3s", "4m", "2h". */
export function formatAgo(fromMs: number, now: number): string {
  const deltaMs = Math.max(0, now - fromMs)
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 3) {
    return 'now'
  }
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}
