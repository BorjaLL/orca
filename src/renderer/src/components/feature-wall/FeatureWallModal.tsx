import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  DEFAULT_FEATURE_WALL_WORKFLOW_ID,
  FEATURE_WALL_WORKFLOWS,
  getFeatureWallMediaTile,
  type FeatureWallInAppActionId,
  type FeatureWallPrimaryCta,
  type FeatureWallWorkflow,
  type FeatureWallWorkflowId
} from '../../../../shared/feature-wall-workflows'
import type { FeatureWallOpenSourceTelemetry } from '../../../../shared/telemetry-events'
import { FEATURE_WALL_MAX_DWELL_MS } from '../../../../shared/feature-wall-telemetry'
import { getAgentsSteps, type AgentsStepId } from '../../../../shared/agents-orchestration-steps'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { track } from '@/lib/telemetry'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  getFeatureWallRailNavigationTarget,
  type FeatureWallRailNavigationKey
} from './feature-wall-rail-navigation'
import { toFeatureWallAssetUrl, useFeatureWallAssetBaseUrl } from './feature-wall-assets'
import { useFeatureWallTaskSourcePresentation } from './use-feature-wall-task-source-presentation'
import { FeatureWallBody } from './FeatureWallBody'
import { AgentsStepper } from './AgentsStepper'
import { FeatureWallRail } from './FeatureWallRail'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const NAVIGATION_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'Home', 'End'])
function getFeatureWallOpenSource(
  modalData: Record<string, unknown>
): FeatureWallOpenSourceTelemetry {
  const source = modalData.source
  return source === 'help_menu' || source === 'popup' ? source : 'unknown'
}
function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false
    }
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    setPrefersReducedMotion(media.matches)
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return prefersReducedMotion
}
type InAppActionDispatcher = (action: FeatureWallInAppActionId) => void
function useInAppActionDispatcher(closeModal: () => void): InAppActionDispatcher {
  const openTaskPage = useAppStore((s) => s.openTaskPage)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const setActiveView = useAppStore((s) => s.setActiveView)

  return useCallback(
    (action) => {
      // Why: close the tour first so the user lands on the surface they
      // asked for. Each action below is fire-and-forget — the corresponding
      // route/state change is what carries the user there.
      closeModal()
      switch (action) {
        case 'open-tasks':
          openTaskPage()
          return
        case 'open-integrations-settings':
          openSettingsTarget({ pane: 'integrations', repoId: null })
          openSettingsPage()
          return
        case 'open-agent-settings':
          openSettingsTarget({ pane: 'agents', repoId: null })
          openSettingsPage()
          return
        case 'focus-terminal':
          setActiveView('terminal')
          return
        case 'open-ssh-settings':
          openSettingsTarget({ pane: 'ssh', repoId: null, sectionId: 'ssh' })
          openSettingsPage()
      }
    },
    [closeModal, openSettingsPage, openSettingsTarget, openTaskPage, setActiveView]
  )
}

export default function FeatureWallModal(): JSX.Element | null {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const isOpen = activeModal === 'feature-wall'
  const assetBaseUrl = useFeatureWallAssetBaseUrl(isOpen)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [selectedId, setSelectedId] = useState<FeatureWallWorkflowId>(
    DEFAULT_FEATURE_WALL_WORKFLOW_ID
  )
  const railRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dispatchInAppAction = useInAppActionDispatcher(closeModal)
  const source = getFeatureWallOpenSource(modalData)
  const telemetryRef = useRef<{ open: boolean; openedAtMs: number }>({
    open: false,
    openedAtMs: 0
  })

  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        FEATURE_WALL_WORKFLOWS.findIndex((w) => w.id === selectedId)
      ),
    [selectedId]
  )
  const selected = FEATURE_WALL_WORKFLOWS[selectedIndex]
  const selectedPresentation = useFeatureWallTaskSourcePresentation(isOpen, selected)
  const settings = useAppStore((s) => s.settings)
  // Why: hide the notifications step when the user already has agent-task
  // notifications enabled — mirrors the toggle in the mock so users who
  // already configured this don't see a redundant pitch.
  const notificationsAlreadyEnabled =
    settings?.notifications.enabled === true && settings?.notifications.agentTaskComplete === true
  const agentsSteps = useMemo(
    () => getAgentsSteps(notificationsAlreadyEnabled),
    [notificationsAlreadyEnabled]
  )
  const [agentsStepId, setAgentsStepId] = useState<AgentsStepId>(
    () => agentsSteps[0]?.id ?? 'statuses'
  )
  // Reset to the first step whenever the visible step list changes so we never
  // land on an id that's been filtered out (e.g. user toggled notifications on
  // mid-tour).
  useEffect(() => {
    if (!agentsSteps.some((s) => s.id === agentsStepId)) {
      setAgentsStepId(agentsSteps[0]?.id ?? 'statuses')
    }
  }, [agentsSteps, agentsStepId])
  const agentsActiveStep =
    selected.id === 'agents-orchestration'
      ? (agentsSteps.find((s) => s.id === agentsStepId) ?? agentsSteps[0] ?? null)
      : null
  const primaryTile = getFeatureWallMediaTile(selected.primaryTileId)
  const posterUrl = primaryTile ? toFeatureWallAssetUrl(assetBaseUrl, primaryTile.posterPath) : null
  const gifUrl = primaryTile ? toFeatureWallAssetUrl(assetBaseUrl, primaryTile.gifPath) : null
  const emitCloseTelemetry = useCallback(() => {
    if (!telemetryRef.current.open) {
      return
    }
    const dwellMs = Math.min(
      FEATURE_WALL_MAX_DWELL_MS,
      Math.max(0, Math.round(performance.now() - telemetryRef.current.openedAtMs))
    )
    track('feature_wall_closed', { dwell_ms: dwellMs })
    telemetryRef.current.open = false
  }, [])

  useEffect(() => {
    if (isOpen && !telemetryRef.current.open) {
      telemetryRef.current = { open: true, openedAtMs: performance.now() }
      track('feature_wall_opened', { source })
      track('feature_wall_group_selected', {
        group_id: DEFAULT_FEATURE_WALL_WORKFLOW_ID,
        source
      })
      const defaultTile = getFeatureWallMediaTile(FEATURE_WALL_WORKFLOWS[0].primaryTileId)
      if (defaultTile) {
        track('feature_wall_feature_selected', {
          group_id: DEFAULT_FEATURE_WALL_WORKFLOW_ID,
          tile_id: defaultTile.id,
          source
        })
        // Keep the legacy hover/focus event firing too for analytics
        // continuity until dashboards are migrated to feature_selected.
        track('feature_wall_tile_focused', { tile_id: defaultTile.id })
      }
      return
    }
    if (!isOpen) {
      emitCloseTelemetry()
    }
  }, [emitCloseTelemetry, isOpen, source])
  useEffect(() => {
    return () => emitCloseTelemetry()
  }, [emitCloseTelemetry])

  // Reset selection on close so reopening lands on the default workflow.
  useEffect(() => {
    if (!isOpen) {
      setSelectedId(DEFAULT_FEATURE_WALL_WORKFLOW_ID)
      setAgentsStepId(agentsSteps[0]?.id ?? 'statuses')
    }
  }, [agentsSteps, isOpen])

  // Reset to the first step whenever the agents-orchestration workflow gets
  // selected, so the user always lands on Statuses first.
  useEffect(() => {
    if (selected.id === 'agents-orchestration') {
      setAgentsStepId(agentsSteps[0]?.id ?? 'statuses')
    }
  }, [agentsSteps, selected.id])

  const handleSelect = useCallback(
    (workflow: FeatureWallWorkflow): void => {
      if (workflow.id === selectedId) {
        return
      }
      setSelectedId(workflow.id)
      track('feature_wall_group_selected', { group_id: workflow.id, source })
      const tile = getFeatureWallMediaTile(workflow.primaryTileId)
      if (tile) {
        track('feature_wall_feature_selected', {
          group_id: workflow.id,
          tile_id: tile.id,
          source
        })
        track('feature_wall_tile_focused', { tile_id: tile.id })
      }
    },
    [selectedId, source]
  )

  const handleRailKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!NAVIGATION_KEYS.has(event.key)) {
      return
    }
    event.preventDefault()
    const nextIndex = getFeatureWallRailNavigationTarget({
      currentIndex: index,
      key: event.key as FeatureWallRailNavigationKey,
      itemCount: FEATURE_WALL_WORKFLOWS.length
    })
    const nextWorkflow = FEATURE_WALL_WORKFLOWS[nextIndex]
    if (!nextWorkflow) {
      return
    }
    handleSelect(nextWorkflow)
    railRefs.current[nextIndex]?.focus()
  }

  const handlePrimaryCta = (cta: FeatureWallPrimaryCta): void => {
    track('feature_wall_primary_cta_clicked', {
      group_id: selected.id,
      action: cta.kind,
      source
    })
    if (cta.kind === 'in-app') {
      dispatchInAppAction(cta.action)
      return
    }
    void window.api.shell.openUrl(cta.url)
    if (primaryTile) {
      // Mirrors the legacy tile_clicked event so docs-as-primary still emits
      // it for downstream dashboards.
      track('feature_wall_tile_clicked', { tile_id: primaryTile.id })
    }
  }

  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      closeModal()
    }
  }

  if (!isOpen && !telemetryRef.current.open) {
    return null
  }

  const showGif = !prefersReducedMotion && gifUrl !== null
  const previewTitleId = `feature-wall-preview-${selected.id}`
  const previewPanelId = 'feature-wall-preview-panel'

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'grid h-[min(780px,calc(100vh-8rem))] w-[calc(100vw-8rem)] gap-0 p-0 sm:max-w-[1240px]',
          agentsActiveStep
            ? 'grid-rows-[auto_minmax(0,1fr)_auto_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)_auto]'
        )}
        tabIndex={-1}
      >
        <DialogHeader className="gap-1 border-b border-border px-7 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Explore Orca
          </div>
          <DialogTitle className="text-lg">Get to know Orca</DialogTitle>
          <DialogDescription className="text-base">
            A short, workflow-by-workflow tour. Pick a path — each one ends with something you can
            try in Orca right now.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[280px_minmax(0,1fr)]">
          <FeatureWallRail
            selectedId={selectedId}
            previewPanelId={previewPanelId}
            railRefs={railRefs}
            onSelect={handleSelect}
            onRailKeyDown={handleRailKeyDown}
          />

          <section
            id={previewPanelId}
            role="tabpanel"
            className="scrollbar-sleek grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-y-auto"
            aria-labelledby={previewTitleId}
          >
            <div className="px-9 pb-3 pt-7">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Workflow {selectedIndex + 1} of {FEATURE_WALL_WORKFLOWS.length} · {selected.title}
              </div>
              <h3
                id={previewTitleId}
                className="text-3xl font-semibold leading-tight tracking-tight"
              >
                {selected.title}
              </h3>
              {agentsActiveStep ? null : (
                <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
                  {selectedPresentation.lede}
                </p>
              )}
            </div>

            <FeatureWallBody
              selected={selected}
              selectedPresentation={selectedPresentation}
              posterUrl={posterUrl}
              gifUrl={gifUrl}
              showGif={showGif}
              prefersReducedMotion={prefersReducedMotion}
              source={source}
              agentsActiveStep={agentsActiveStep}
            />
          </section>
        </div>

        {agentsActiveStep ? (
          <AgentsStepper
            steps={agentsSteps}
            activeStepId={agentsActiveStep.id}
            onSelect={setAgentsStepId}
          />
        ) : null}

        <footer className="flex flex-col gap-3 border-t border-border bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <span className="text-xs text-muted-foreground">
            Reopen any time from Help &gt; Explore Orca.
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {selected.id === 'agents-orchestration' ? null : (
              <Button
                className="w-full sm:w-auto"
                onClick={() => handlePrimaryCta(selectedPresentation.primaryCta)}
              >
                {selectedPresentation.primaryCta.label}
                <ChevronRight className="size-3.5" />
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
