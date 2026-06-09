import { useMemo } from 'react'
import { useBackend } from './backend-context'
import { useLiveFeed } from './use-live-feed'
import { deriveNeedsAttention, type AttentionItem } from './needs-attention'

/**
 * Subscribe to the three poll feeds that drive Needs-attention (tasks, gates,
 * messages) and return the unified, deep-linkable list. Shared by the shell's
 * count badge and the rails so the number and the contents never disagree.
 */
export function useNeedsAttention(): AttentionItem[] {
  const { backend } = useBackend()
  const tasksFeed = useMemo(() => backend.tasks(), [backend])
  const gatesFeed = useMemo(() => backend.gates(), [backend])
  const inboxFeed = useMemo(() => backend.inbox(), [backend])

  const tasks = useLiveFeed(tasksFeed)
  const gates = useLiveFeed(gatesFeed)
  const messages = useLiveFeed(inboxFeed)

  return useMemo(
    () =>
      deriveNeedsAttention({
        tasks: tasks.value ?? [],
        gates: gates.value ?? [],
        messages: messages.value ?? []
      }),
    [tasks.value, gates.value, messages.value]
  )
}
