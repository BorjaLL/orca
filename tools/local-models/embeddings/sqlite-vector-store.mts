// sqlite-vec backend for indexes too large to hold in memory. Vectors live in a
// vec0 virtual table; metadata lives in a plain table joined by rowid — so we
// lean on sqlite-vec only for its core KNN, not for metadata filtering.
//
// Opt in with LOCAL_MODEL_STORE=sqlite. Needs deps the JSON path doesn't:
//   pnpm add sqlite-vec && pnpm rebuild:node
// (better-sqlite3 ships built for Electron; rebuild:node makes it loadable by
// plain Node.) They're required lazily so the default JSON store never needs them.

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SearchHit, StoredChunk, VectorIndex } from './vector-store.mts'

export function sqliteIndexPath(repoRoot: string): string {
  return join(repoRoot, 'tools/local-models/.cache/repo-index.db')
}

export class SqliteVectorStore implements VectorIndex {
  private path: string
  private db: any = null
  private dim = 0

  constructor(path: string) {
    this.path = path
  }

  open(): void {
    let Database: any
    let sqliteVec: any
    try {
      const require = createRequire(import.meta.url)
      Database = require('better-sqlite3')
      sqliteVec = require('sqlite-vec')
    } catch (err) {
      throw new Error(
        'sqlite store needs better-sqlite3 + sqlite-vec. Run:\n' +
          '  pnpm add sqlite-vec && pnpm rebuild:node\n' +
          `(original error: ${err instanceof Error ? err.message : err})`
      )
    }

    mkdirSync(dirname(this.path), { recursive: true })
    this.db = new Database(this.path)
    sqliteVec.load(this.db)
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS chunks (' +
        'id INTEGER PRIMARY KEY, hash TEXT UNIQUE, file TEXT, ' +
        'start_line INTEGER, end_line INTEGER, text TEXT)'
    )
    const dimRow = this.db.prepare("SELECT value FROM meta WHERE key = 'dim'").get()
    if (dimRow) this.dim = Number(dimRow.value)
  }

  // vec0 needs the dimension up front, so the vector table is created on the
  // first upsert once we've seen an embedding.
  private ensureVecTable(dim: number): void {
    if (this.dim !== 0) return
    this.dim = dim
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(` +
        `embedding float[${dim}] distance_metric=cosine)`
    )
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dim', ?)").run(String(dim))
  }

  storedHashes(): Set<string> {
    const rows = this.db.prepare('SELECT hash FROM chunks').all() as { hash: string }[]
    return new Set(rows.map((r) => r.hash))
  }

  upsert(chunks: StoredChunk[]): void {
    if (chunks.length === 0) return
    this.ensureVecTable(chunks[0].embedding.length)
    const insertChunk = this.db.prepare(
      'INSERT OR IGNORE INTO chunks (hash, file, start_line, end_line, text) VALUES (?, ?, ?, ?, ?)'
    )
    const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)')
    const tx = this.db.transaction((rows: StoredChunk[]) => {
      for (const row of rows) {
        const res = insertChunk.run(row.hash, row.file, row.startLine, row.endLine, row.text)
        if (res.changes === 0) continue // hash already present
        insertVec.run(res.lastInsertRowid, JSON.stringify(row.embedding))
      }
    })
    tx(chunks)
  }

  deleteByHash(hashes: string[]): void {
    if (hashes.length === 0) return
    const findId = this.db.prepare('SELECT id FROM chunks WHERE hash = ?')
    const delVec = this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?')
    const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?')
    const tx = this.db.transaction((rows: string[]) => {
      for (const hash of rows) {
        const found = findId.get(hash) as { id: number } | undefined
        if (!found) continue
        delVec.run(found.id)
        delChunk.run(found.id)
      }
    })
    tx(hashes)
  }

  search(queryEmbedding: number[], topK: number): SearchHit[] {
    if (this.dim === 0) return [] // nothing indexed yet
    const rows = this.db
      .prepare(
        'SELECT c.file, c.start_line AS startLine, c.end_line AS endLine, c.text, v.distance ' +
          'FROM vec_chunks v JOIN chunks c ON c.id = v.rowid ' +
          'WHERE v.embedding MATCH ? ORDER BY v.distance LIMIT ?'
      )
      .all(JSON.stringify(queryEmbedding), topK) as Array<ChunkRow & { distance: number }>
    // cosine distance is in [0, 2]; convert to a similarity score for parity with JSON.
    return rows.map((r) => ({
      chunk: { file: r.file, startLine: r.startLine, endLine: r.endLine, text: r.text },
      score: 1 - r.distance
    }))
  }

  save(): void {} // writes happen transactionally in upsert/delete

  close(): void {
    if (this.db) this.db.close()
  }

  get size(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }
    return row.n
  }
}

interface ChunkRow {
  file: string
  startLine: number
  endLine: number
  text: string
}
