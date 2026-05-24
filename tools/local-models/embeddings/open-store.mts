// Picks the index backend from config (LOCAL_MODEL_STORE). Both build and search
// go through here so switching backends is a single env var, not a code change.

import { defaultIndexPath, JsonVectorStore, type VectorIndex } from './vector-store.mts'
import { SqliteVectorStore, sqliteIndexPath } from './sqlite-vector-store.mts'
import { loadConfig } from '../local-model-config.mts'

export function openStore(repoRoot: string): VectorIndex {
  const store =
    loadConfig().store === 'sqlite'
      ? new SqliteVectorStore(sqliteIndexPath(repoRoot))
      : new JsonVectorStore(defaultIndexPath(repoRoot))
  store.open()
  return store
}
