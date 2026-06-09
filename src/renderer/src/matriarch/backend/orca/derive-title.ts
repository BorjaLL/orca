// TaskRow carries only `spec`; the UI leads with a short human title. Derive one
// deterministically: prefer the worktree branch for autonomous-worker prompts
// (whose first line is identical boilerplate), else the first non-empty line —
// trimmed of trailing punctuation and budget-truncated on a word boundary. Pure
// + side-effect-free so it's testable.

const MAX_TITLE_LENGTH = 56

export function deriveTaskTitle(spec: string): string {
  const firstLine = spec
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) {
    return 'Untitled task'
  }

  // Worker prompts all open with "You are an autonomous WORKER in Orca worktree
  // branch <branch>…". The branch is the recognizable unit of work (one PR per
  // branch), so lead with it rather than the boilerplate the card body repeats.
  const branchLeaf = /^you are an? (autonomous )?worker\b/i.test(firstLine)
    ? extractWorktreeBranchLeaf(spec)
    : null
  const headline = branchLeaf ?? firstLine

  const cleaned = headline.replace(/[.:;,\s]+$/, '')
  if (cleaned.length <= MAX_TITLE_LENGTH) {
    return cleaned
  }
  const clipped = cleaned.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = clipped.lastIndexOf(' ')
  // Why: prefer a word boundary so we never cut mid-word, but fall back to a
  // hard clip when the first token alone already exceeds the budget.
  const base = lastSpace > MAX_TITLE_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped
  return `${base.replace(/[.:;,\s]+$/, '')}…`
}

/** The leaf of an "Orca worktree branch <owner>/<name>" reference, e.g.
 *  `BorjaLL/cli-workspace-status` → `cli-workspace-status`. Null when absent. */
function extractWorktreeBranchLeaf(spec: string): string | null {
  const match = spec.match(/worktree branch\s+([^\s,;]+)/i)
  if (!match) {
    return null
  }
  const leaf = match[1].split('/').pop()?.trim()
  return leaf && leaf.length > 0 ? leaf : null
}
