import { useCallback, useEffect, useRef, useState } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import { useAppStore, type AppState } from '@/store'
import {
  cancelRuntimeGeneratePullRequestFields,
  generateRuntimePullRequestFields
} from '@/runtime/runtime-git-client'
import {
  getRuntimeRepoBaseRefDefault,
  searchRuntimeRepoBaseRefs
} from '@/runtime/runtime-repo-client'
import { resolveCommitMessageAgentChoice } from '../../../../shared/commit-message-agent-spec'
import type { HostedReviewCreationEligibility } from '../../../../shared/hosted-review'
import { resolvePullRequestGenerationControl } from './pull-request-generation-control'
import {
  buildPullRequestGenerationInput,
  resolveGeneratedPullRequestFieldUpdate,
  stripBaseRef,
  type GenerationSeed
} from './pull-request-field-generation'

type UseCreatePullRequestDialogFieldsOptions = {
  open: boolean
  repoId: string
  worktreeId: string | null
  worktreePath: string
  branch: string
  eligibility: HostedReviewCreationEligibility | null
  settings: AppState['settings']
  submitting: boolean
}

export function useCreatePullRequestDialogFields({
  open,
  repoId,
  worktreeId,
  worktreePath,
  branch,
  eligibility,
  settings,
  submitting
}: UseCreatePullRequestDialogFieldsOptions) {
  const commitMessageAi = settings?.commitMessageAi
  const effectiveCommitMessageAgentId = resolveCommitMessageAgentChoice(
    commitMessageAi?.agentId,
    settings?.defaultTuiAgent
  )
  const initializedFromEligibilityRef = useRef<string | null>(null)
  const generateInFlightRef = useRef(false)
  const generationRequestIdRef = useRef(0)
  const generationSeedRef = useRef<GenerationSeed | null>(null)
  const latestFieldsRef = useRef({
    base: '',
    title: '',
    body: '',
    draft: false
  })
  const [base, setBase] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [baseQuery, setBaseQuery] = useState('')
  const [baseResults, setBaseResults] = useState<string[]>([])
  const [baseSearchError, setBaseSearchError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  useEffect(() => {
    latestFieldsRef.current = { base, title, body, draft }
  }, [base, body, draft, title])

  useEffect(() => {
    if (!open) {
      generationRequestIdRef.current += 1
      if (generateInFlightRef.current && worktreePath) {
        const connectionId = getConnectionId(worktreeId) ?? undefined
        void cancelRuntimeGeneratePullRequestFields({
          settings,
          worktreeId,
          worktreePath,
          connectionId
        })
      }
      generateInFlightRef.current = false
      generationSeedRef.current = null
      initializedFromEligibilityRef.current = null
      setGenerating(false)
      setGenerateError(null)
      return
    }
    if (!eligibility) {
      return
    }
    const initializationKey = `${repoId}:${branch}`
    if (initializedFromEligibilityRef.current === initializationKey) {
      return
    }
    // Why: eligibility refreshes while the dialog is open; only seed fields
    // once per branch so late refreshes do not overwrite user edits.
    initializedFromEligibilityRef.current = initializationKey
    const initialBase = eligibility.defaultBaseRef ?? ''
    setBase(stripBaseRef(initialBase))
    setTitle(eligibility.title ?? '')
    setBody(eligibility.body ?? '')
    setDraft(false)
    setBaseQuery('')
    setBaseResults([])
    setBaseSearchError(null)
    setGenerateError(null)
  }, [branch, eligibility, open, repoId, settings, worktreeId, worktreePath])

  useEffect(() => {
    if (!open || base) {
      return
    }
    let stale = false
    void getRuntimeRepoBaseRefDefault(settings, repoId)
      .then((result) => {
        if (!stale && result.defaultBaseRef) {
          setBase(stripBaseRef(result.defaultBaseRef))
        }
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [base, open, repoId, settings])

  useEffect(() => {
    if (!open || baseQuery.trim().length < 2) {
      setBaseResults([])
      setBaseSearchError(null)
      return
    }
    let stale = false
    const timer = window.setTimeout(() => {
      void searchRuntimeRepoBaseRefs(settings, repoId, baseQuery.trim(), 20)
        .then((results) => {
          if (!stale) {
            setBaseResults(results.map(stripBaseRef))
            setBaseSearchError(null)
          }
        })
        .catch(() => {
          if (!stale) {
            setBaseResults([])
            setBaseSearchError('Branch discovery failed.')
          }
        })
    }, 200)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [baseQuery, open, repoId, settings])

  const generationControl = resolvePullRequestGenerationControl({
    submitting,
    aiEnabled: commitMessageAi?.enabled === true,
    agentId: effectiveCommitMessageAgentId,
    customAgentCommand: commitMessageAi?.customAgentCommand ?? '',
    base,
    generating
  })

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (
      !worktreePath ||
      !base.trim() ||
      generateInFlightRef.current ||
      generationControl.disabled
    ) {
      return
    }
    const requestId = generationRequestIdRef.current + 1
    generationRequestIdRef.current = requestId
    const seed = { requestId, base, title, body, draft }
    generationSeedRef.current = seed
    generateInFlightRef.current = true
    setGenerating(true)
    setGenerateError(null)
    try {
      const connectionId = getConnectionId(worktreeId) ?? undefined
      const result = await generateRuntimePullRequestFields(
        {
          settings: useAppStore.getState().settings,
          worktreeId,
          worktreePath,
          connectionId
        },
        buildPullRequestGenerationInput({ base, title, body, draft })
      )
      if (generationRequestIdRef.current !== requestId) {
        return
      }
      if (!result.success) {
        if (result.canceled) {
          setGenerateError(null)
          return
        }
        setGenerateError(result.error)
        return
      }

      const update = resolveGeneratedPullRequestFieldUpdate(
        generationSeedRef.current,
        latestFieldsRef.current,
        requestId,
        result.fields
      )
      if (!update.ok) {
        setGenerateError(update.error)
        return
      }
      setBase(update.fields.base)
      setBaseQuery('')
      setBaseResults([])
      setTitle(update.fields.title)
      setBody(update.fields.body)
      setDraft(update.fields.draft)
      setGenerateError(null)
    } catch (error) {
      if (generationRequestIdRef.current !== requestId) {
        return
      }
      setGenerateError(
        error instanceof Error ? error.message : 'Failed to generate pull request details'
      )
    } finally {
      if (generationRequestIdRef.current === requestId) {
        generateInFlightRef.current = false
        generationSeedRef.current = null
        setGenerating(false)
      }
    }
  }, [base, body, draft, generationControl.disabled, title, worktreeId, worktreePath])

  const handleCancelGenerate = useCallback((): void => {
    if (!worktreePath || !generateInFlightRef.current) {
      return
    }
    generationRequestIdRef.current += 1
    generateInFlightRef.current = false
    generationSeedRef.current = null
    setGenerating(false)
    setGenerateError(null)
    const connectionId = getConnectionId(worktreeId) ?? undefined
    void cancelRuntimeGeneratePullRequestFields({
      settings: useAppStore.getState().settings,
      worktreeId,
      worktreePath,
      connectionId
    })
  }, [worktreeId, worktreePath])

  return {
    aiGenerationEnabled: generationControl.visible,
    base,
    setBase,
    title,
    setTitle,
    body,
    setBody,
    draft,
    setDraft,
    baseQuery,
    setBaseQuery,
    baseResults,
    setBaseResults,
    baseSearchError,
    generating,
    generateError,
    generateDisabled: generationControl.disabled,
    generateDisabledReason: generationControl.disabledReason,
    handleGenerate,
    handleCancelGenerate
  }
}
