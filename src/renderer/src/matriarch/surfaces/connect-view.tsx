import { useMemo, useState } from 'react'
import { Cable, Loader2, MonitorPlay, Server, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  createStoredWebRuntimeEnvironment,
  isMixedContentWebSocket,
  readStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from '../../web/web-runtime-environment'
import { parseWebPairingInput } from '../../web/web-pairing'
import { WebRuntimeClient } from '../../web/web-runtime-client'

/**
 * Connect / pair screen. Reuses Orca's real pairing parse + E2EE client to
 * validate a runtime-scope pairing offer, then stores it and hands control up.
 * Offers a sample-data path so the portal is explorable without a runtime.
 */
export function ConnectView({
  initialPairingInput,
  onPaired,
  onUseSampleData
}: {
  initialPairingInput: string | null
  onPaired: () => void
  onUseSampleData: () => void
}): React.JSX.Element {
  const existing = readStoredWebRuntimeEnvironment()
  const [name, setName] = useState(existing?.name ?? 'Orca runtime')
  const [code, setCode] = useState(initialPairingInput ?? '')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const offer = useMemo(() => parseWebPairingInput(code), [code])
  const invalid = code.trim().length > 0 && !offer

  const connect = async (): Promise<void> => {
    setError(null)
    if (!offer) {
      setError('Enter a valid Orca pairing URL or pairing code.')
      return
    }
    if (isMixedContentWebSocket(offer.endpoint)) {
      setError(
        'This HTTPS page cannot reach a plain ws:// runtime. Open the portal over HTTP or pair a wss:// endpoint.'
      )
      return
    }
    setConnecting(true)
    const environment = createStoredWebRuntimeEnvironment({ name, offer })
    const client = new WebRuntimeClient(offer)
    try {
      const response = await client.call('status.get', undefined, { timeoutMs: 15_000 })
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      saveStoredWebRuntimeEnvironment({
        ...environment,
        runtimeId: response._meta.runtimeId,
        lastUsedAt: Date.now()
      })
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      client.close()
      setConnecting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-6 text-foreground">
      <Card className="w-full max-w-[460px] gap-5 rounded-xl p-7">
        <div className="flex flex-col items-start gap-1">
          <div className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="text-lg leading-none" aria-hidden>
              ◐
            </span>
            Matriarch Portal
          </div>
          <span className="text-[13px] text-muted-foreground">Connect to a backend</span>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="mp-name" className="text-[13px] font-medium">
            Backend name
          </label>
          <input
            id="mp-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="mp-code" className="text-[13px] font-medium">
            Pairing URL or code
          </label>
          <input
            id="mp-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="orca://pair?code=…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid}
            className={cn(
              'h-9 rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
              invalid && 'border-destructive focus-visible:ring-destructive/20'
            )}
          />
          {invalid && (
            <span className="text-xs text-destructive">
              Invalid pairing code. Expected an orca:// pairing URL or code.
            </span>
          )}
          {offer && (
            <span className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              Endpoint: {offer.endpoint}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          onClick={() => void connect()}
          disabled={connecting || !offer}
          className="w-full gap-2"
        >
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Connecting…
            </>
          ) : (
            <>
              <Cable className="size-4" aria-hidden />
              Connect
            </>
          )}
        </Button>

        {existing && (
          <button
            type="button"
            onClick={onPaired}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-accent"
          >
            <Server className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-[13px] font-medium">{existing.name}</span>
            <Badge variant="dot" className="ml-auto gap-1.5">
              <Wifi className="size-3" aria-hidden />
              saved
            </Badge>
          </button>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          or
        </div>

        <Button variant="outline" onClick={onUseSampleData} className="w-full gap-2">
          <MonitorPlay className="size-4" aria-hidden />
          Explore with sample data
        </Button>

        <span className="text-[11px] text-muted-foreground">
          Secret tokens are never displayed. Pairing is end-to-end encrypted over the runtime
          handshake.
        </span>
      </Card>
    </div>
  )
}
