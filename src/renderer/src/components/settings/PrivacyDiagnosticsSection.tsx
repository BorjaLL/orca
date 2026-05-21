import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Folder, Globe, Trash2 } from 'lucide-react'
import type { DiagnosticsStatusPayload } from '../../../../preload/api-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'

export function PrivacyDiagnosticsSection(): React.JSX.Element {
  const [status, setStatus] = useState<DiagnosticsStatusPayload | null>(null)

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.diagnostics.getStatus()
      setStatus(next)
    } catch {
      /* swallow — pane shows N/A while the IPC is unavailable */
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      await window.api.diagnostics.openTraceFolder()
    } catch {
      toast.error('Could not open trace folder')
    }
  }, [])

  const handleClear = useCallback(async (): Promise<void> => {
    try {
      await window.api.diagnostics.clearTraces()
      await refreshStatus()
      toast.success('Local trace files cleared')
    } catch {
      toast.error('Could not clear trace files')
    }
  }, [refreshStatus])

  return (
    <>
      {status?.disabledReason ? (
        <DiagnosticsDisabledStateNote reason={status.disabledReason} />
      ) : null}
      <Separator />
      <Section
        icon={<Folder className="size-4" />}
        title="Open trace folder"
        description={`Reveals ${status?.traceFilePath || 'the trace folder'} in your file manager.`}
      >
        <Button variant="outline" size="sm" onClick={() => void handleOpenFolder()}>
          Open trace folder
        </Button>
      </Section>
      <Separator />
      <Section
        icon={<Trash2 className="size-4" />}
        title="Clear local traces"
        description="Deletes every rotated trace file on this machine."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!status?.localFileEnabled}
          onClick={() => void handleClear()}
        >
          Clear local traces
        </Button>
      </Section>
      <Separator />
      <Section
        icon={<Globe className="size-4" />}
        title="OTLP export"
        description={
          status?.otlpStatus ??
          'Set ORCA_OTLP_TRACES_URL to point Orca at your own OpenTelemetry collector.'
        }
      >
        <span
          className={
            status?.otlpEnabled
              ? 'text-xs font-medium text-foreground'
              : 'text-xs text-muted-foreground'
          }
        >
          {status?.otlpEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </Section>
    </>
  )
}

function DiagnosticsDisabledStateNote({
  reason
}: {
  reason: NonNullable<DiagnosticsStatusPayload['disabledReason']>
}): React.JSX.Element {
  const message =
    reason === 'do_not_track'
      ? 'DO_NOT_TRACK=1 is set — network-bound diagnostics are disabled. The local trace file is still active.'
      : reason === 'orca_telemetry_disabled'
        ? 'ORCA_TELEMETRY_DISABLED=1 is set — network-bound diagnostics are disabled. The local trace file is still active.'
        : reason === 'orca_diagnostics_disabled'
          ? 'ORCA_DIAGNOSTICS_DISABLED=1 is set — every diagnostics surface is off, including local trace writes.'
          : reason === 'ci'
            ? 'Running in CI — diagnostics are off.'
            : 'Diagnostics are disabled by an environment variable.'

  return (
    <div className="rounded border border-dashed border-border/60 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
      {message}
    </div>
  )
}

function Section({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-1 items-start gap-3">
        <div className="mt-1 text-muted-foreground">{icon}</div>
        <div className="space-y-1">
          <Label className="text-sm">{title}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:justify-end sm:self-center">
        {children}
      </div>
    </div>
  )
}
