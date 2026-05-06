import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import NewWorkspaceComposerCard from '@/components/NewWorkspaceComposerCard'
import AgentSettingsDialog from '@/components/agent/AgentSettingsDialog'
import { useComposerState } from '@/hooks/useComposerState'
import {
  pickQuickWorkspaceAgent,
  resolveQuickWorkspaceAgentSelection
} from '@/lib/quick-workspace-agent-selection'
import { defaultBuiltinTuiAgent } from '@/lib/custom-agent-resolve'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { shouldAllowComposerEnterSubmitTarget } from '@/lib/new-workspace-enter-guard'
import { isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import type {
  TuiAgent,
  WorkspaceCreateTelemetrySource,
  WorkspaceStatus
} from '../../../shared/types'
import { translate } from '@/i18n/i18n'

type ComposerModalData = {
  prefilledName?: string
  initialRepoId?: string
  linkedWorkItem?: LinkedWorkItemSummary | null
  initialBaseBranch?: string
  initialWorkspaceStatus?: WorkspaceStatus
  /** Telemetry surface that opened the composer. Set by each
   *  `openModal('new-workspace-composer', ...)` site so
   *  `workspace_created.source` carries the right value. Falls back to
   *  `unknown` when omitted. */
  telemetrySource?: WorkspaceCreateTelemetrySource
  contextualTourSource?: string
  setupGuideTourRequestId?: string
}

export default function NewWorkspaceComposerModal(): React.JSX.Element | null {
  const visible = useAppStore((s) => s.activeModal === 'new-workspace-composer')
  const modalData = useAppStore((s) => s.modalData as ComposerModalData | undefined)
  const closeModal = useAppStore((s) => s.closeModal)

  // Why: Dialog open-state transitions must be driven by the store, not a
  // mirror useState, so palette/open-modal calls feel instantaneous and the
  // modal doesn't linger with stale data after close.
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeModal()
      }
    },
    [closeModal]
  )

  if (!visible) {
    return null
  }

  return (
    <ComposerModalBody
      modalData={modalData ?? {}}
      onClose={closeModal}
      onOpenChange={handleOpenChange}
    />
  )
}

function ComposerModalBody({
  modalData,
  onClose,
  onOpenChange
}: {
  modalData: ComposerModalData
  onClose: () => void
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Why: Radix's FocusScope fires this once the dialog has mounted.
          // preventDefault stops it from focusing whatever first-tabbable it
          // picks (close button), and we instead focus the repo picker so the
          // keyboard flow starts at the top of the unified create form.
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          const trigger = content.querySelector<HTMLElement>(
            '[data-repo-combobox-root="true"][role="combobox"]'
          )
          trigger?.focus({ preventScroll: true })
        }}
      >
        <QuickTabBody modalData={modalData} onClose={onClose} active />
      </DialogContent>
    </Dialog>
  )
}

function QuickTabBody({
  modalData,
  onClose,
  active
}: {
  modalData: ComposerModalData
  onClose: () => void
  active: boolean
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const {
    cardProps,
    composerRef,
    onComposerNodeChange,
    nameInputRef,
    submitQuick,
    createDisabled
  } = useComposerState({
    initialName: modalData.prefilledName ?? '',
    // Why: the modal is quick-create only now, so prompt-prefill state is
    // intentionally ignored even if older callers still send it.
    initialPrompt: '',
    initialLinkedWorkItem: modalData.linkedWorkItem ?? null,
    initialRepoId: modalData.initialRepoId,
    initialWorkspaceStatus: modalData.initialWorkspaceStatus,
    ...(modalData.initialBaseBranch ? { initialBaseBranch: modalData.initialBaseBranch } : {}),
    persistDraft: false,
    onCreated: onClose,
    ...(modalData.telemetrySource ? { telemetrySource: modalData.telemetrySource } : {}),
    enableIssueAutomation: false,
    createGateMode: 'quick'
  })
  // Why: the composer's built-in `onOpenAgentSettings` handler navigates to
  // the settings page and closes the modal. For the quick-create flow we want
  // a less disruptive affordance — a nested dialog layered over the composer
  // so the user can tweak agents without losing their in-progress workspace
  // name/repo selection.
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  // Why: once the user picks an agent, their choice wins and must not be
  // overwritten when the derived "preferred" value changes (e.g. detection
  // finishes and adds more installed agents to the set). Track that with an
  // override rather than an effect that mirrors a prop into state — deriving
  // during render keeps the selection in sync with the detected set without
  // triggering an extra commit.
  const [quickAgentOverride, setQuickAgentOverride] = useState<TuiAgent | null | undefined>(
    undefined
  )
  const [quickCustomAgentOverride, setQuickCustomAgentOverride] = useState<
    string | null | undefined
  >(undefined)
  const preferredQuickAgent = useMemo<TuiAgent | null>(() => {
    // Why: detection can still be pending when quick-create submits; keep the
    // prior catalog fallback while filtering disabled agents out of that choice.
    // A custom-profile default resolves to its baseAgent for this built-in slot;
    // the parallel customAgentId slot (below) carries the profile id.
    return pickQuickWorkspaceAgent(
      defaultBuiltinTuiAgent(settings),
      cardProps.detectedAgentIds,
      settings?.disabledTuiAgents
    )
  }, [cardProps.detectedAgentIds, settings])
  const preferredQuickCustomAgentId = useMemo<string | null>(() => {
    const pref = settings?.defaultTuiAgent
    if (pref && typeof pref === 'object' && pref.kind === 'custom') {
      const profile = (settings?.customAgents ?? []).find((p) => p.id === pref.id)
      return profile ? profile.id : null
    }
    return null
  }, [settings?.defaultTuiAgent, settings?.customAgents])
  const resolvedQuickAgentSelection = resolveQuickWorkspaceAgentSelection({
    quickAgentOverride,
    preferredQuickAgent,
    detectedAgentIds: cardProps.detectedAgentIds,
    disabledTuiAgents: settings?.disabledTuiAgents
  })
  if (resolvedQuickAgentSelection.quickAgentOverride !== quickAgentOverride) {
    // Why: detection/settings changes can invalidate a user-picked agent; repair
    // before the child selector renders an unavailable option for one commit.
    setQuickAgentOverride(resolvedQuickAgentSelection.quickAgentOverride)
  }
  const quickAgent = resolvedQuickAgentSelection.quickAgent
  const quickCustomAgentId =
    quickCustomAgentOverride === undefined ? preferredQuickCustomAgentId : quickCustomAgentOverride

  const handleQuickAgentChange = useCallback((agent: TuiAgent | null) => {
    setQuickAgentOverride(agent)
    // Why: switching to a built-in or blank explicitly clears any active
    // custom selection. Mirrors how onValueChange in AgentCombobox sends
    // both updates together for a custom → builtin transition.
    setQuickCustomAgentOverride(null)
  }, [])
  const handleQuickCustomAgentChange = useCallback((id: string | null) => {
    setQuickCustomAgentOverride(id)
  }, [])

  const handleCreate = useCallback(async (): Promise<void> => {
    await submitQuick(quickAgent, quickCustomAgentId)
  }, [quickAgent, quickCustomAgentId, submitQuick])
  const primaryActionLabel = cardProps.selectedRepoIsGit ? 'Create Worktree' : 'Create Workspace'

  // Cmd/Ctrl+Enter submits, Esc first blurs the focused input (like the full page).
  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== 'Escape') {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      if (event.key === 'Escape') {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable
        ) {
          event.preventDefault()
          target.blur()
          return
        }
        event.preventDefault()
        onClose()
        return
      }

      // Why: workspace creation is screen-local submit behavior, not a
      // user-configurable app command.
      if (!isScreenSubmitShortcut(event)) {
        return
      }
      if (!shouldAllowComposerEnterSubmitTarget(target, composerRef.current)) {
        return
      }
      if (createDisabled) {
        return
      }
      event.preventDefault()
      void handleCreate()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [active, composerRef, createDisabled, handleCreate, onClose])

  return (
    <>
      <DialogHeader className="gap-1">
        <DialogTitle className="text-base font-semibold">{primaryActionLabel}</DialogTitle>
        <DialogDescription className="sr-only">
          {translate(
            'auto.components.NewWorkspaceComposerModal.fa90f739a5',
            'Choose the project, workspace name, and agent before creating the workspace.'
          )}
        </DialogDescription>
      </DialogHeader>
      <NewWorkspaceComposerCard
        contextualTourSource={modalData.contextualTourSource}
        // Why: the scroll container clips children, while Orca's standard
        // field focus ring paints 3px outside the control. Inset both sides so
        // keyboard focus stays fully visible at the dialog edges.
        containerClassName="min-h-0 flex-1 overflow-y-auto px-1 scrollbar-sleek"
        composerRef={composerRef}
        onComposerNodeChange={onComposerNodeChange}
        nameInputRef={nameInputRef}
        quickAgent={quickAgent}
        onQuickAgentChange={handleQuickAgentChange}
        quickCustomAgentId={quickCustomAgentId}
        onQuickCustomAgentChange={handleQuickCustomAgentChange}
        {...cardProps}
        primaryActionLabel={primaryActionLabel}
        onOpenAgentSettings={() => setAgentSettingsOpen(true)}
        onCreate={() => void handleCreate()}
      />
      <AgentSettingsDialog open={agentSettingsOpen} onOpenChange={setAgentSettingsOpen} />
    </>
  )
}
