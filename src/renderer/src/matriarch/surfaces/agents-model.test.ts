import { describe, expect, it } from 'vitest'
import { matchesAgent, selectAgents, shouldShowAgentType } from './agents-model'
import type { AgentSnapshot } from '../backend'

const agent = (o: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  handle: o.handle ?? 'term_a',
  paneKey: o.paneKey ?? 'tab:leaf',
  label: o.label ?? 'Wire the ports',
  state: o.state ?? 'working',
  prompt: o.prompt ?? 'do the thing',
  stateStartedAt: 0,
  updatedAt: 0,
  isCoordinator: o.isCoordinator ?? false,
  ...o
})

describe('selectAgents — ordering', () => {
  it('sorts coordinators to the front, stable otherwise', () => {
    const fleet = [
      agent({ handle: 'w1', isCoordinator: false }),
      agent({ handle: 'c1', isCoordinator: true }),
      agent({ handle: 'w2', isCoordinator: false })
    ]
    expect(selectAgents(fleet, 'all', '').map((a) => a.handle)).toEqual(['c1', 'w1', 'w2'])
  })
  it('does not mutate the input array', () => {
    const fleet = [agent({ handle: 'w' }), agent({ handle: 'c', isCoordinator: true })]
    selectAgents(fleet, 'all', '')
    expect(fleet.map((a) => a.handle)).toEqual(['w', 'c'])
  })
})

describe('selectAgents — state filter', () => {
  const fleet = [
    agent({ handle: 'a', state: 'working' }),
    agent({ handle: 'b', state: 'waiting' }),
    agent({ handle: 'c', state: 'blocked' }),
    agent({ handle: 'd', state: 'idle' })
  ]
  it('all keeps everything', () => {
    expect(selectAgents(fleet, 'all', '')).toHaveLength(4)
  })
  it('an exact state keeps only that state', () => {
    expect(selectAgents(fleet, 'blocked', '').map((a) => a.handle)).toEqual(['c'])
    expect(selectAgents(fleet, 'waiting', '').map((a) => a.handle)).toEqual(['b'])
  })
})

describe('selectAgents — search', () => {
  const fleet = [
    agent({ handle: 'term_dda', label: 'Run logic tests', prompt: 'compare 3.4 vs 3.5' }),
    agent({ handle: 'term_portal', label: 'Wire the ports', prompt: 'edit board-view' })
  ]
  it('matches the handle', () => {
    expect(selectAgents(fleet, 'all', 'dda').map((a) => a.handle)).toEqual(['term_dda'])
  })
  it('matches the label', () => {
    expect(selectAgents(fleet, 'all', 'wire').map((a) => a.handle)).toEqual(['term_portal'])
  })
  it('matches the prompt', () => {
    expect(selectAgents(fleet, 'all', '3.5').map((a) => a.handle)).toEqual(['term_dda'])
  })
  it('is case-insensitive and trims', () => {
    expect(selectAgents(fleet, 'all', '  PORTAL ').map((a) => a.handle)).toEqual(['term_portal'])
  })
  it('combines the state filter and the query (AND)', () => {
    const mixed = [
      agent({ handle: 'term_dda', state: 'blocked' }),
      agent({ handle: 'term_x', state: 'working', label: 'dda thing' })
    ]
    expect(selectAgents(mixed, 'blocked', 'dda').map((a) => a.handle)).toEqual(['term_dda'])
  })
})

describe('matchesAgent', () => {
  it('expects a pre-lowercased query (no internal lowercasing of the query)', () => {
    // The caller lowercases once; an upper-case query here will not match.
    expect(matchesAgent(agent({ handle: 'term_a' }), 'all', 'TERM')).toBe(false)
    expect(matchesAgent(agent({ handle: 'term_a' }), 'all', 'term')).toBe(true)
  })
})

describe('shouldShowAgentType', () => {
  it('is false for a homogeneous fleet', () => {
    expect(
      shouldShowAgentType([agent({ agentType: 'claude' }), agent({ agentType: 'claude' })])
    ).toBe(false)
  })
  it('is true when >= 2 distinct types exist', () => {
    expect(
      shouldShowAgentType([agent({ agentType: 'claude' }), agent({ agentType: 'codex' })])
    ).toBe(true)
  })
  it('ignores missing types', () => {
    expect(
      shouldShowAgentType([agent({ agentType: undefined }), agent({ agentType: 'claude' })])
    ).toBe(false)
  })
  it('is false for an empty fleet', () => {
    expect(shouldShowAgentType([])).toBe(false)
  })
})
