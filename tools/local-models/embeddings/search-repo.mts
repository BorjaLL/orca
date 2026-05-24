// Semantic search over the local index. Embeds the query with the same local
// model, ranks chunks by cosine similarity, prints file:line locations + a
// snippet. Run: `node tools/local-models/embeddings/search-repo.mts "where is X handled"`

import { repoRootFromCwd } from './code-chunker.mts'
import { openStore } from './open-store.mts'
import { createClientFromEnv } from '../local-model-client.mts'

const TOP_K = 8
const SNIPPET_LINES = 4

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim()
  if (query === '') {
    console.error('Usage: search-repo.mts "<natural language query>"')
    process.exitCode = 1
    return
  }

  const repoRoot = repoRootFromCwd()
  const store = openStore(repoRoot)
  if (store.size === 0) {
    console.error('No index found. Run build-repo-index.mts first.')
    store.close()
    process.exitCode = 1
    return
  }

  const [queryEmbedding] = await createClientFromEnv().embed(query)
  const hits = store.search(queryEmbedding, TOP_K)
  store.close()

  for (const { chunk, score } of hits) {
    const snippet = chunk.text.split('\n').slice(0, SNIPPET_LINES).join('\n    ')
    console.log(`\n${chunk.file}:${chunk.startLine}-${chunk.endLine}  (${score.toFixed(3)})`)
    console.log(`    ${snippet}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
