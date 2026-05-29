import type { IBufferLine, IBufferRange } from '@xterm/xterm'
import { extractTerminalFileLinkCandidates, resolveTerminalFileLink } from '@/lib/terminal-links'
import { openDetectedFilePath } from './terminal-file-open-routing'
import {
  buildHardWrappedPathLogicalLineCandidates,
  buildWrappedLogicalLine,
  rangeForParsedFileLink,
  type WrappedLogicalLine
} from './wrapped-terminal-link-ranges'

type FileLinkHitTestDeps = {
  startupCwd: string
  terminalHomePath?: string | null
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId?: string | null
  pathExistsCache?: Map<string, boolean>
}

export type ResolvedTerminalFileLink = {
  absolutePath: string
  line: number | null
  column: number | null
}

/** A terminal file link resolved at a right-click position, plus whether it
 *  points at a local file (remote/SSH runtime paths can't use the local OS). */
export type TerminalFileLinkMenuTarget = ResolvedTerminalFileLink & {
  isLocal: boolean
  runtimeEnvironmentId: string | null
}

/** Resolves the file link under a terminal MouseEvent without opening it.
 *  Returns null when the click is not over a known file path. */
export type TerminalFileLinkResolver = (
  paneId: number,
  event: MouseEvent
) => TerminalFileLinkMenuTarget | null

// Why: shared by the ⌘-click open path and the right-click context menu, which
// needs the resolved path without triggering an open. Returns the best match at
// the buffer position using the same caching/length preference as opening.
export function resolveFilePathLinkAtBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  position: { x: number; y: number },
  terminalColumns: number,
  deps: FileLinkHitTestDeps
): ResolvedTerminalFileLink | null {
  const logicalLines = buildCandidateLogicalLinesForBufferPosition(buffer, position.y)
  if (logicalLines.length === 0) {
    return null
  }

  for (const logicalLine of logicalLines) {
    const matches: {
      absolutePath: string
      line: number | null
      column: number | null
      pathText: string
      cachedExists: boolean | undefined
    }[] = []
    for (const parsed of extractTerminalFileLinkCandidates(logicalLine.text)) {
      const resolved = deps.startupCwd
        ? resolveTerminalFileLink(parsed, deps.startupCwd, deps.terminalHomePath)
        : null
      if (!resolved) {
        continue
      }
      const range = rangeForParsedFileLink(logicalLine, parsed.startIndex, parsed.endIndex)
      if (!range || !rangeContainsBufferPosition(range, position, terminalColumns)) {
        continue
      }
      const cacheKey = `${deps.runtimeEnvironmentId ?? 'active'}\0${resolved.absolutePath}`
      matches.push({
        absolutePath: resolved.absolutePath,
        line: resolved.line,
        column: resolved.column,
        pathText: parsed.pathText,
        cachedExists: deps.pathExistsCache?.get(cacheKey)
      })
    }

    const cachedMatch = matches
      .filter((match) => match.cachedExists)
      .sort((a, b) => b.pathText.length - a.pathText.length)[0]
    const uncachedMatch = matches.find((match) => match.cachedExists !== false)
    const match = cachedMatch ?? uncachedMatch
    if (match) {
      return { absolutePath: match.absolutePath, line: match.line, column: match.column }
    }
  }

  return null
}

export function openFilePathLinkAtBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  position: { x: number; y: number },
  terminalColumns: number,
  deps: FileLinkHitTestDeps
): boolean {
  const match = resolveFilePathLinkAtBufferPosition(buffer, position, terminalColumns, deps)
  if (!match) {
    return false
  }
  openDetectedFilePath(match.absolutePath, match.line, match.column, deps)
  return true
}

export function buildCandidateLogicalLinesForBufferPosition(
  buffer: { getLine(y: number): IBufferLine | undefined },
  bufferLineNumber: number
): WrappedLogicalLine[] {
  const hardWrappedCandidates = buildHardWrappedPathLogicalLineCandidates(buffer, bufferLineNumber)
  const softWrappedLogicalLine = buildWrappedLogicalLine(buffer, bufferLineNumber)
  const candidates = softWrappedLogicalLine
    ? [...hardWrappedCandidates, softWrappedLogicalLine]
    : hardWrappedCandidates
  return dedupeLogicalLines(candidates)
}

export function dedupeLogicalLines(logicalLines: WrappedLogicalLine[]): WrappedLogicalLine[] {
  const seen = new Set<string>()
  return logicalLines.filter((logicalLine) => {
    if (seen.has(logicalLine.fingerprint)) {
      return false
    }
    seen.add(logicalLine.fingerprint)
    return true
  })
}

function rangeContainsBufferPosition(
  range: IBufferRange,
  position: { x: number; y: number },
  terminalColumns: number
): boolean {
  const lower = range.start.y * terminalColumns + range.start.x
  const upper = range.end.y * terminalColumns + range.end.x
  const current = position.y * terminalColumns + position.x
  return lower <= current && current <= upper
}
