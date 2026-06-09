import { createContext, useContext } from 'react'
import type { ConnectionState, MatriarchBackend } from '../backend'

export type BackendContextValue = {
  backend: MatriarchBackend
  connectionState: ConnectionState
}

// Why: a non-null assertion-free context — components must be inside the
// provider, so a missing provider is a programmer error we surface loudly.
export const BackendContext = createContext<BackendContextValue | null>(null)

export function useBackend(): BackendContextValue {
  const value = useContext(BackendContext)
  if (!value) {
    throw new Error('useBackend must be used within a BackendProvider')
  }
  return value
}
