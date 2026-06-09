// Pure logic for the Agents view's filter / sort / search (PRD FR9). Lifted out
// of agents-view.tsx so the ordering rule (coordinator first), the state filter,
// the multi-field search, and the homogeneous-fleet type-chip suppression are
// unit-tested instead of living inline in JSX — the same extract-and-test pattern
// as board-model / inbox-model / gate-model.

import type { AgentSnapshot, AgentState } from '../backend'

/** The state filter the segmented control offers (a subset of AgentState + all). */
export type AgentFilter = 'all' | 'working' | 'waiting' | 'blocked'

/**
 * Order, filter, and search the fleet in one pass:
 * - coordinator(s) sort to the front (the matriarch is the anchor of the view),
 *   stable within each group;
 * - the state filter keeps `all` or an exact state match;
 * - the query matches the handle, label, or prompt (case-insensitive substring),
 *   so an operator can find a worker by what it is doing.
 * Pure: returns a new array, never mutates the input.
 */
export function selectAgents(
  agents: AgentSnapshot[],
  filter: AgentFilter,
  query: string
): AgentSnapshot[] {
  const ordered = [...agents].sort((a, b) => Number(b.isCoordinator) - Number(a.isCoordinator))
  const q = query.trim().toLowerCase()
  return ordered.filter((agent) => matchesAgent(agent, filter, q))
}

/** Whether one agent passes the state filter + a pre-lowercased query. */
export function matchesAgent(
  agent: AgentSnapshot,
  filter: AgentFilter,
  lowerQuery: string
): boolean {
  const matchFilter = filter === 'all' || agent.state === (filter as AgentState)
  if (!matchFilter) {
    return false
  }
  if (lowerQuery.length === 0) {
    return true
  }
  return (
    agent.handle.toLowerCase().includes(lowerQuery) ||
    agent.label.toLowerCase().includes(lowerQuery) ||
    agent.prompt.toLowerCase().includes(lowerQuery)
  )
}

/**
 * The agent-type chip is noise when the whole fleet is one type (e.g. all
 * `claude`); show it only when there are >= 2 distinct, non-empty types.
 */
export function shouldShowAgentType(agents: AgentSnapshot[]): boolean {
  const types = new Set<string>()
  for (const agent of agents) {
    if (agent.agentType) {
      types.add(agent.agentType)
    }
  }
  return types.size > 1
}
