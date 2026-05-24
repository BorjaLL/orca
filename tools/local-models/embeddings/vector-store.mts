// Dead-simple JSON-backed vector store. A whole repo's chunks fit comfortably in
// memory at this scale, so cosine search is just a loop — no native deps, no
// server. Swap this module for sqlite-vec / a real vector DB when the index
// outgrows memory; the interface (upsert / search) is the seam to keep stable.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** On-disk index location, kept under the tool's gitignored .cache dir. */
export function defaultIndexPath(repoRoot: string): string {
  return join(repoRoot, 'tools/local-models/.cache/repo-index.json')
}

export interface StoredChunk {
  file: string
  startLine: number
  endLine: number
  text: string
  embedding: number[]
}

export interface SearchHit {
  chunk: StoredChunk
  score: number
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

export class VectorStore {
  private path: string
  private chunks: StoredChunk[] = []

  constructor(path: string) {
    this.path = path
  }

  load(): void {
    try {
      this.chunks = JSON.parse(readFileSync(this.path, 'utf8')) as StoredChunk[]
    } catch {
      this.chunks = [] // no index yet — first run
    }
  }

  replaceAll(chunks: StoredChunk[]): void {
    this.chunks = chunks
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.chunks))
  }

  get size(): number {
    return this.chunks.length
  }

  search(queryEmbedding: number[], topK: number): SearchHit[] {
    return this.chunks
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}
