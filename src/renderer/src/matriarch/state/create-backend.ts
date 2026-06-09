import type { MatriarchBackend } from '../backend'
import { MockMatriarchBackend, OrcaMatriarchBackend } from '../backend'
import {
  getPreferredWebPairingOffer,
  readStoredWebRuntimeEnvironment,
  type StoredWebRuntimeEnvironment
} from '../../web/web-runtime-environment'

/** Construct the Orca reference backend from a stored, paired environment. */
export function createOrcaBackend(environment: StoredWebRuntimeEnvironment): MatriarchBackend {
  const offer = getPreferredWebPairingOffer(environment)
  return new OrcaMatriarchBackend(environment.name, offer)
}

/** The mock backend (run_7a3 fixtures) for the design-data dev mode. */
export function createMockBackend(): MatriarchBackend {
  return new MockMatriarchBackend({ animate: true })
}

/** True when the URL opts into sample-data mode (no pairing required). */
export function isMockModeRequested(location: Location): boolean {
  const params = new URLSearchParams(location.search)
  if (params.get('mock') !== null || params.get('demo') !== null) {
    return true
  }
  return location.hash.replace(/^#/, '') === 'mock'
}

/** A paired environment ready to connect, if one is stored. */
export function readPairedEnvironment(): StoredWebRuntimeEnvironment | null {
  return readStoredWebRuntimeEnvironment()
}
