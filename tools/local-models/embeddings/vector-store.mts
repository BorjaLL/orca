// Storage layer for the semantic index. `VectorIndex` is the seam both backends
// implement: the JSON store (zero deps, default) and the sqlite-vec store (scale).
// Identity is a content hash of file+text, so re-indexing can skip unchanged
// chunks instead of re-embedding the whole repo every run.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ChunkLocation {
  file: string
  startLine: number
  endLine: number
  text: string
}

export interface StoredChunk extends ChunkLocation {
  hash: string
  embedding: number[]
}

export interface SearchHit {
  chunk: ChunkLocation
  score: number
}

/** Stable identity for a chunk. Embeddings depend only on text, but we fold in
 * the file path so identical windows in different files stay distinct. */
export function chunkHash(file: string, text: string): string {
  return createHash('sha1').update(file).update('\0').update(text).digest('hex')
}

// The seam: incremental indexing drives this, so a new backend only needs these.
export interface VectorIndex {
  open(): void
  /** Hashes already embedded — lets the indexer embed only what's new. */
  storedHashes(): Set<string>
  upsert(chunks: StoredChunk[]): void
  deleteByHash(hashes: string[]): void
  search(queryEmbedding: number[], topK: number): SearchHit[]
  save(): void
  close(): void
  readonly size: number
}

/** On-disk index location, kept under the tool's gitignored .cache dir. */
export function defaultIndexPath(repoRoot: string): string {
  return join(repoRoot, 'tools/local-models/.cache/repo-index.json')
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// Whole-repo indexes fit in memory at this scale, so cosine search is just a
// loop. Keyed by hash so upsert/delete are O(1) and re-indexing stays in place.
export class JsonVectorStore implements VectorIndex {
  private path: string
  private chunks = new Map<string, StoredChunk>()

  constructor(path: string) {
    this.path = path
  }

  open(): void {
    try {
      const rows = JSON.parse(readFileSync(this.path, 'utf8')) as StoredChunk[]
      for (const row of rows) {
        // Self-heal indexes written before hashing existed.
        const hash = row.hash ?? chunkHash(row.file, row.text)
        this.chunks.set(hash, { ...row, hash })
      }
    } catch {
      this.chunks = new Map() // no index yet — first run
    }
  }

  storedHashes(): Set<string> {
    return new Set(this.chunks.keys())
  }

  upsert(chunks: StoredChunk[]): void {
    for (const chunk of chunks) this.chunks.set(chunk.hash, chunk)
  }

  deleteByHash(hashes: string[]): void {
    for (const hash of hashes) this.chunks.delete(hash)
  }

  search(queryEmbedding: number[], topK: number): SearchHit[] {
    return [...this.chunks.values()]
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify([...this.chunks.values()]))
  }

  close(): void {}

  get size(): number {
    return this.chunks.size
  }
}
