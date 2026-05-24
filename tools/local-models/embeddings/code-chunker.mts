// Turns the tracked files of a repo into overlapping line-windows ready for
// embedding. We shell out to `git ls-files` so .gitignore, node_modules and
// untracked junk are excluded for free, and the chunker stays language-agnostic.

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

export interface CodeChunk {
  file: string
  startLine: number
  endLine: number
  text: string
}

// Plain-text/code extensions worth indexing. Extend as needed.
const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.html', '.md', '.mdx', '.yaml', '.yml',
  '.py', '.rs', '.go', '.java', '.rb', '.sh', '.toml'
])

const MAX_FILE_BYTES = 512 * 1024
const WINDOW_LINES = 80
const OVERLAP_LINES = 20

function listTrackedFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  return out.toString('utf8').split('\0').filter(Boolean)
}

export function chunkRepo(repoRoot: string): CodeChunk[] {
  const chunks: CodeChunk[] = []
  for (const relPath of listTrackedFiles(repoRoot)) {
    if (!INDEXABLE_EXTENSIONS.has(extname(relPath))) continue
    const absPath = join(repoRoot, relPath)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(absPath)
    } catch {
      continue // file listed by git but missing on disk (e.g. mid-rebase)
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue

    const lines = readFileSync(absPath, 'utf8').split('\n')
    for (let start = 0; start < lines.length; start += WINDOW_LINES - OVERLAP_LINES) {
      const end = Math.min(start + WINDOW_LINES, lines.length)
      const text = lines.slice(start, end).join('\n').trim()
      if (text.length === 0) continue
      chunks.push({ file: relPath, startLine: start + 1, endLine: end, text })
      if (end === lines.length) break
    }
  }
  return chunks
}

export function repoRootFromCwd(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel']).toString('utf8').trim()
}
