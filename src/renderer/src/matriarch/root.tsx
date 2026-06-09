import { useState } from 'react'
import { Toaster } from 'sonner'
import type { MatriarchBackend } from './backend'
import { ConnectView } from './surfaces/connect-view'
import { PortalApp, useDarkMode } from './app'
import {
  createMockBackend,
  createOrcaBackend,
  isMockModeRequested,
  readPairedEnvironment
} from './state/create-backend'
import {
  clearPairingInputFromAddressBar,
  parseWebPairingInput,
  readPairingInputFromLocation
} from '../web/web-pairing'
import {
  createStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from '../web/web-runtime-environment'

/**
 * Top-level portal root: resolves the connection (mock mode, a pairing offer in
 * the URL, or a stored environment) and otherwise shows Connect. Owns the
 * backend instance lifecycle and the theme.
 */
export function MatriarchRoot(): React.JSX.Element {
  const [dark, toggleDark] = useDarkMode()
  const [backend, setBackend] = useState<MatriarchBackend | null>(() => initialBackend())
  const [initialPairingInput] = useState<string | null>(() =>
    readPairingInputFromLocation(window.location)
  )

  return (
    <>
      {backend ? (
        <PortalApp backend={backend} dark={dark} onToggleDark={toggleDark} />
      ) : (
        <ConnectView
          initialPairingInput={initialPairingInput}
          onPaired={() => {
            const environment = readPairedEnvironment()
            if (environment) {
              setBackend(createOrcaBackend(environment))
            }
          }}
          onUseSampleData={() => setBackend(createMockBackend())}
        />
      )}
      {/* Portal-owned toasts (Open in Orca failures, hand-to-matriarch). Themed by
          the portal's own dark state; styled with the design-system popover tokens. */}
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="bottom-right"
        closeButton
        toastOptions={{ className: 'font-sans text-sm' }}
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)'
          } as React.CSSProperties
        }
      />
    </>
  )
}

/** Resolve a backend at boot without showing Connect, when possible. */
function initialBackend(): MatriarchBackend | null {
  if (isMockModeRequested(window.location)) {
    return createMockBackend()
  }
  // A pairing offer in the URL fragment → store it, clear the bar, connect.
  const pairingInput = readPairingInputFromLocation(window.location)
  const offer = pairingInput ? parseWebPairingInput(pairingInput) : null
  if (offer) {
    const environment = createStoredWebRuntimeEnvironment({ name: 'Orca runtime', offer })
    saveStoredWebRuntimeEnvironment(environment)
    clearPairingInputFromAddressBar()
    return createOrcaBackend(environment)
  }
  const stored = readPairedEnvironment()
  return stored ? createOrcaBackend(stored) : null
}
