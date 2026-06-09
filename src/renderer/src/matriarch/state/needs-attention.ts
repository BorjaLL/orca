import type { AgentSnapshot, Gate, Message, Task } from '../backend'

export type AttentionKind = 'gate' | 'escalation' | 'blocked-task' | 'failed-task' | 'waiting-agent'

/** One row in the Needs-attention rail; deep-links to its source. */
export type AttentionItem = {
  id: string
  kind: AttentionKind
  /** amber for waiting/gate, red for failure/escalation. */
  tone: 'amber' | 'red'
  title: string
  body: string
  /** Handle to focus an agent card, when relevant. */
  handle?: string
  /** Task id to open the task detail, when relevant. */
  taskId?: string
}

/**
 * Unify everything that needs a human into one ordered list (PRD FR19/Story 4.4):
 * pending gates, escalation messages, failed + blocked tasks. Dedup by source id;
 * urgent (red) sorts above waiting (amber). Pure so it's testable and cheap to
 * recompute on every feed tick.
 */
export function deriveNeedsAttention(input: {
  tasks?: Task[]
  gates?: Gate[]
  messages?: Message[]
  agents?: AgentSnapshot[]
}): AttentionItem[] {
  const items: AttentionItem[] = []
  const seen = new Set<string>()
  const push = (item: AttentionItem): void => {
    if (seen.has(item.id)) {
      return
    }
    seen.add(item.id)
    items.push(item)
  }

  for (const gate of input.gates ?? []) {
    if (gate.status === 'pending') {
      push({
        id: `gate:${gate.id}`,
        kind: 'gate',
        tone: 'amber',
        title: 'Decision gate',
        body: gate.question,
        handle: gate.toHandle,
        taskId: gate.taskId
      })
    }
  }

  for (const message of input.messages ?? []) {
    if (message.type === 'escalation') {
      push({
        id: `esc:${message.id}`,
        kind: 'escalation',
        tone: 'red',
        title: 'Escalation',
        body: message.body,
        handle: message.fromHandle
      })
    }
  }

  for (const task of input.tasks ?? []) {
    if (task.status === 'failed') {
      push({
        id: `task-failed:${task.id}`,
        kind: 'failed-task',
        tone: 'red',
        title: `Worker failed${task.attempts ? ` ×${task.attempts.split('/')[0]}` : ''}`,
        body: task.result || `${task.title} failed.`,
        handle: task.assigneeHandle,
        taskId: task.id
      })
    } else if (task.status === 'blocked') {
      push({
        id: `task-blocked:${task.id}`,
        kind: 'blocked-task',
        tone: 'amber',
        title: 'Blocked task',
        body: task.title,
        handle: task.assigneeHandle,
        taskId: task.id
      })
    }
  }

  // Why: red (failure/escalation) outranks amber (waiting) so the most urgent
  // signal is always at the top of the rail.
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1))
}
