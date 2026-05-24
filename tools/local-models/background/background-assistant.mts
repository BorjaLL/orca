// Always-on background helper: watches the working tree and, a beat after you
// save a file, asks the local model for a quick "anything obviously wrong?" read
// on that file's uncommitted diff. Free, local, and out of Claude's token budget.
//
// Run: `node tools/local-models/background/background-assistant.mts`
// Stop: Ctrl-C.
//
// The `runTask` function is the extension seam — swap it for TODO extraction,
// test-stub drafting, changelog notes, etc. Keep tasks read-only and cheap.

import { execFileSync } from 'node:child_process'
import { watch } from 'node:fs'
import { extname } from 'node:path'
import { repoRootFromCwd } from '../embeddings/code-chunker.mts'
import { createClientFromEnv, type LocalModelClient } from '../local-model-client.mts'

const DEBOUNCE_MS = 1500
const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.css'])
const IGNORED_SEGMENTS = ['/.git/', '/node_modules/', '/out/', '/dist/', '/.cache/']

function fileDiff(repoRoot: string, relPath: string): string {
  try {
    return execFileSync('git', ['diff', '--no-color', '--', relPath], {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024
    }).toString('utf8')
  } catch {
    return ''
  }
}

async function runTask(client: LocalModelClient, relPath: string, diff: string): Promise<void> {
  const review = await client.chat([
    {
      role: 'system',
      content:
        'You review a single file diff. Reply with at most 3 terse bullets on real ' +
        'problems (bugs, typos in identifiers, missed edge cases). If clean, reply "ok".'
    },
    { role: 'user', content: diff }
  ])
  const verdict = review.trim()
  if (verdict === '' || verdict.toLowerCase() === 'ok') return
  console.log(`\n[${new Date().toLocaleTimeString()}] ${relPath}\n${verdict}`)
}

function main(): void {
  const repoRoot = repoRootFromCwd()
  const client = createClientFromEnv()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  console.log(`Watching ${repoRoot} — saves trigger a local-model diff review. Ctrl-C to stop.`)

  // Recursive watch is supported on macOS and Windows (the M5 target). On Linux
  // it is not, so this would need a per-directory walk or a watcher library.
  watch(repoRoot, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const relPath = filename.toString()
    if (IGNORED_SEGMENTS.some((seg) => `/${relPath}`.includes(seg))) return
    if (!WATCHED_EXTENSIONS.has(extname(relPath))) return

    clearTimeout(pending.get(relPath))
    pending.set(
      relPath,
      setTimeout(() => {
        pending.delete(relPath)
        const diff = fileDiff(repoRoot, relPath)
        if (diff.trim() === '') return
        runTask(client, relPath, diff).catch((err) => {
          console.error('[background] task failed:', err instanceof Error ? err.message : err)
        })
      }, DEBOUNCE_MS)
    )
  })
}

main()
