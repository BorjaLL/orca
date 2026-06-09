// Pure, provider-agnostic logic for the R3 Review & Ship surface (PRD FR28/FR31,
// NFR9 graceful degradation). This module is deliberately backend-independent: it
// encodes the per-provider vocabulary and capability matrix so the UI can label
// and enable/disable ship actions correctly the moment a backend exposes review
// status. The actual review-status read + diff are a BACKEND ADDITION for the
// portal (the runtime's hostedReview surface is Electron-IPC only today, not on
// the WebRuntimeClient RPC the portal speaks) - see reviewStatus? on the backend
// interface. Keeping the capability rules here, pure and tested, de-risks that
// later wiring: when the RPC lands, the UI logic is already proven.

/** Source-control providers the portal speaks about (extensible). */
export type ReviewProvider = 'github' | 'gitlab'

/** A capability a provider may or may not support for review/ship. */
export type ReviewCapability =
  | 'create' // open a PR/MR
  | 'merge' // merge / squash / rebase
  | 'comment' // top-level comment
  | 'lineComment' // per-line inline comment
  | 'threadResolve' // resolve a review thread
  | 'autoMerge' // queue an auto-merge
  | 'reviewers' // request reviewers

export type CapabilityMatrix = Record<ReviewCapability, boolean>

/**
 * Per-provider capability matrix. Grounded in the PRD R3 asymmetry note: GitLab
 * lacks thread-resolve, line-level MR comments, and auto-merge/reviewers parity.
 * A provider the portal does not know about degrades to the safe common subset.
 */
const CAPABILITIES: Record<ReviewProvider, CapabilityMatrix> = {
  github: {
    create: true,
    merge: true,
    comment: true,
    lineComment: true,
    threadResolve: true,
    autoMerge: true,
    reviewers: true
  },
  gitlab: {
    create: true,
    merge: true,
    comment: true,
    lineComment: false,
    threadResolve: false,
    autoMerge: false,
    reviewers: false
  }
}

/** The safe common subset for an unknown provider: only what every host supports. */
const COMMON_SUBSET: CapabilityMatrix = {
  create: true,
  merge: true,
  comment: true,
  lineComment: false,
  threadResolve: false,
  autoMerge: false,
  reviewers: false
}

/** The capability matrix for a provider; unknown providers get the common subset. */
export function providerCapabilities(provider: string): CapabilityMatrix {
  return CAPABILITIES[provider as ReviewProvider] ?? COMMON_SUBSET
}

/** Whether a provider supports a given capability. */
export function supportsCapability(provider: string, capability: ReviewCapability): boolean {
  return providerCapabilities(provider)[capability]
}

/** The short noun a provider uses for a review unit: GitHub "PR" vs GitLab "MR". */
export function reviewUnitLabel(provider: string): string {
  switch (provider) {
    case 'github':
      return 'PR'
    case 'gitlab':
      return 'MR'
    default:
      return 'review'
  }
}

/** A ship/review action the UI offers, with whether this provider enables it and
 *  a human reason when it does not (drives the disabled-with-explanation UI). */
export type ReviewAction = {
  capability: ReviewCapability
  label: string
  enabled: boolean
  /** Present only when disabled — why the provider can't do it. */
  disabledReason?: string
}

const ACTION_LABELS: Record<ReviewCapability, string> = {
  create: 'Create',
  merge: 'Merge',
  comment: 'Comment',
  lineComment: 'Inline comment',
  threadResolve: 'Resolve thread',
  autoMerge: 'Auto-merge',
  reviewers: 'Request reviewers'
}

/**
 * The full action list for a provider, each flagged enabled/disabled with a
 * reason. The label uses the provider's review noun (Create PR vs Create MR).
 * Pure, so the UI never hard-codes a GitHub-only assumption (NFR9).
 */
export function reviewActions(provider: string): ReviewAction[] {
  const caps = providerCapabilities(provider)
  const unit = reviewUnitLabel(provider)
  return (Object.keys(ACTION_LABELS) as ReviewCapability[]).map((capability) => {
    const enabled = caps[capability]
    const baseLabel = ACTION_LABELS[capability]
    const label =
      capability === 'create' || capability === 'merge' ? `${baseLabel} ${unit}` : baseLabel
    return enabled
      ? { capability, label, enabled }
      : {
          capability,
          label,
          enabled: false,
          disabledReason: `${unit} on ${provider} does not support ${baseLabel.toLowerCase()}.`
        }
  })
}
