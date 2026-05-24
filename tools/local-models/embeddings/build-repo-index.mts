// Builds the semantic index: chunk the repo, embed every chunk with the local
// embedding model, write the vectors to disk. Re-run whenever the code drifts
// (cheap and fully offline). Run: `node tools/local-models/embeddings/build-repo-index.mts`

import { chunkRepo, repoRootFromCwd } from './code-chunker.mts'
import { defaultIndexPath, VectorStore, type StoredChunk } from './vector-store.mts'
import { createClientFromEnv } from '../local-model-client.mts'

const EMBED_BATCH = 32

async function main(): Promise<void> {
  const repoRoot = repoRootFromCwd()
  const client = createClientFromEnv()

  console.log('Chunking repo…')
  const chunks = chunkRepo(repoRoot)
  console.log(`  ${chunks.length} chunks`)

  const stored: StoredChunk[] = []
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH)
    const vectors = await client.embed(batch.map((c) => c.text))
    for (let j = 0; j < batch.length; j++) {
      stored.push({ ...batch[j], embedding: vectors[j] })
    }
    process.stdout.write(`\r  embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`)
  }
  process.stdout.write('\n')

  const store = new VectorStore(defaultIndexPath(repoRoot))
  store.replaceAll(stored)
  store.save()
  console.log(`Index written: ${defaultIndexPath(repoRoot)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
