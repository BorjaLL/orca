import { useEffect, useState } from 'react'
import type { ConnectionState, MatriarchBackend } from '../backend'

/** Subscribe to a backend's connection state for the shell indicator. */
export function useConnectionState(backend: MatriarchBackend): ConnectionState {
  const [state, setState] = useState<ConnectionState>(backend.connectionState)
  useEffect(() => {
    return backend.onConnectionChange(setState)
  }, [backend])
  return state
}
