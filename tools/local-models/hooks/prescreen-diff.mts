// Advisory diff pre-screen powered by the local model — zero API cost, zero
// cloud round-trip. Reads the staged diff and prints a short risk summary.
//
// Two ways to use it:
//   1. Standalone before a commit:  node tools/local-models/hooks/prescreen-diff.mts
//   2. As a Claude Code PreToolUse hook on git commits (see settings.example.json).
//
// It is intentionally non-blocking: it always exits 0 and only prints advice, so
// a slow or offline local model never stands between you and a commit.

import { execFileSync } from 'node:child_process'
import { createClientFromEnv } from '../local-model-client.mts'

const MAX_DIFF_CHARS = 24000

function stagedDiff(): string {
  try {
    return execFileSync('git', ['diff', '--cached', '--no-color'], {
      maxBuffer: 32 * 1024 * 1024
    }).toString('utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  const diff = stagedDiff()
  if (diff.trim() === '') return // nothing staged — stay silent

  const truncated = diff.length > MAX_DIFF_CHARS
  const review = await createClientFromEnv().chat([
    {
      role: 'system',
      content:
        'You are a fast pre-commit reviewer. Given a git diff, reply with at most ' +
        '5 short bullet points flagging likely bugs, leftover debug code, secrets, ' +
        'or risky changes. If nothing stands out, reply exactly "LGTM". Be terse.'
    },
    {
      role: 'user',
      content: (truncated ? diff.slice(0, MAX_DIFF_CHARS) + '\n…(diff truncated)…' : diff)
    }
  ])

  const verdict = review.trim()
  if (verdict === '' || verdict === 'LGTM') {
    console.log('[local prescreen] LGTM')
    return
  }
  console.log('[local prescreen]\n' + verdict)
}

main().catch((err) => {
  // Advisory only — never block on failure, just note it.
  console.error('[local prescreen] skipped:', err instanceof Error ? err.message : err)
})
