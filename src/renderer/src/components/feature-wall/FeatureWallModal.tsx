import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
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
import { PreviewMedia, RelatedFeatures } from './FeatureWallPreview'

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
    }
  }, [isOpen])

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

  const handleSecondaryDocs = (): void => {
    if (!primaryTile) {
      return
    }
    track('feature_wall_docs_clicked', {
      group_id: selected.id,
      tile_id: primaryTile.id,
      source
    })
    track('feature_wall_tile_clicked', { tile_id: primaryTile.id })
    void window.api.shell.openUrl(selected.docsUrl)
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
        className="grid h-[min(660px,calc(100vh-2rem))] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-[1040px]"
        tabIndex={-1}
      >
        <DialogHeader className="gap-1 border-b border-border px-6 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            Feature tour
          </div>
          <DialogTitle className="text-base">Get to know Orca</DialogTitle>
          <DialogDescription>
            A short, workflow-by-workflow tour. Pick a path — each one ends with something you can
            try in Orca right now.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav
            className="scrollbar-sleek max-h-44 overflow-y-auto border-b border-border bg-card p-2 md:max-h-none md:border-b-0 md:border-r"
            aria-label="Workflows"
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Workflows
            </div>
            <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
              {FEATURE_WALL_WORKFLOWS.map((workflow, index) => {
                const isSelected = workflow.id === selectedId
                return (
                  <div key={workflow.id}>
                    <button
                      ref={(node) => {
                        railRefs.current[index] = node
                      }}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      aria-controls={previewPanelId}
                      tabIndex={isSelected ? 0 : -1}
                      data-feature-wall-workflow-id={workflow.id}
                      onClick={() => handleSelect(workflow)}
                      onKeyDown={(event) => handleRailKeyDown(event, index)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors',
                        'hover:bg-accent',
                        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        isSelected && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-card font-mono text-[11px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="truncate font-medium leading-tight">{workflow.title}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {workflow.meta}
                        </span>
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </nav>

          <section
            id={previewPanelId}
            role="tabpanel"
            className="scrollbar-sleek grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-y-auto"
            aria-labelledby={previewTitleId}
          >
            <div className="px-8 pb-3 pt-6">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Workflow {selectedIndex + 1} of {FEATURE_WALL_WORKFLOWS.length} · {selected.title}
              </div>
              <h3 id={previewTitleId} className="text-xl font-semibold leading-tight">
                {selected.title}
              </h3>
              <p className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
                {selected.lede}
              </p>
            </div>

            <div className="grid grid-cols-1 items-start gap-6 px-8 pb-8 pt-2 lg:grid-cols-[minmax(0,1fr)_320px]">
              <PreviewMedia
                key={selected.id}
                posterUrl={posterUrl}
                gifUrl={gifUrl}
                showGif={showGif}
                workflowTitle={selected.title}
              />

              <aside className="flex flex-col gap-5">
                <ul className="flex flex-col gap-2.5" role="list">
                  {selected.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-2.5 text-[13px] leading-relaxed"
                    >
                      <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-foreground/40" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                {selected.relatedTileIds.length > 0 ? (
                  <RelatedFeatures workflow={selected} source={source} />
                ) : null}
              </aside>
            </div>
          </section>
        </div>

        <footer className="flex flex-col gap-3 border-t border-border bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="text-[11px] text-muted-foreground">
            Reopen any time from Help &gt; Feature tour.
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="link" className="w-full sm:w-auto" onClick={handleSecondaryDocs}>
              <ExternalLink className="size-3.5" />
              Open docs
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => handlePrimaryCta(selected.primaryCta)}
            >
              {selected.primaryCta.label}
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
