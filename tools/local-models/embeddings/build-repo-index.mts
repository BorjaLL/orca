// Builds/refreshes the semantic index incrementally: only chunks whose content
// changed get re-embedded, stale chunks get dropped. First run embeds everything;
// later runs are near-instant unless code moved. Fully offline.
// Run: `node tools/local-models/embeddings/build-repo-index.mts`

import { chunkRepo, repoRootFromCwd } from './code-chunker.mts'
import { chunkHash, type StoredChunk } from './vector-store.mts'
import { openStore } from './open-store.mts'
import { createClientFromEnv } from '../local-model-client.mts'

const EMBED_BATCH = 32

async function main(): Promise<void> {
  const repoRoot = repoRootFromCwd()
  const client = createClientFromEnv()
  const store = openStore(repoRoot)

  const chunks = chunkRepo(repoRoot).map((c) => ({ ...c, hash: chunkHash(c.file, c.text) }))
  const currentHashes = new Set(chunks.map((c) => c.hash))
  const known = store.storedHashes()

  const toEmbed = chunks.filter((c) => !known.has(c.hash))
  const toDelete = [...known].filter((h) => !currentHashes.has(h))

  console.log(`Repo: ${chunks.length} chunks — reuse ${chunks.length - toEmbed.length}, ` +
    `embed ${toEmbed.length}, drop ${toDelete.length}`)

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH)
    const vectors = await client.embed(batch.map((c) => c.text))
    const embedded: StoredChunk[] = batch.map((c, j) => ({ ...c, embedding: vectors[j] }))
    store.upsert(embedded)
    process.stdout.write(`\r  embedded ${Math.min(i + EMBED_BATCH, toEmbed.length)}/${toEmbed.length}`)
  }
  if (toEmbed.length > 0) process.stdout.write('\n')

  store.deleteByHash(toDelete)
  store.save()
  const total = store.size
  store.close()
  console.log(`Index ready — ${total} chunks.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
