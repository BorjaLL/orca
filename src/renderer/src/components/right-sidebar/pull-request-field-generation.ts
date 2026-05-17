import { normalizeHostedReviewBaseRef } from '../../../../shared/hosted-review-refs'

export type PullRequestFieldSnapshot = {
  base: string
  title: string
  body: string
  draft: boolean
}

export type GenerationSeed = PullRequestFieldSnapshot & {
  requestId: number
}

export type GeneratedPullRequestFieldUpdate =
  | {
      ok: true
      fields: PullRequestFieldSnapshot
    }
  | {
      ok: false
      error: string
    }

export function stripBaseRef(ref: string): string {
  return normalizeHostedReviewBaseRef(ref)
}

export function buildPullRequestGenerationInput({
  base,
  title,
  body,
  draft
}: PullRequestFieldSnapshot): PullRequestFieldSnapshot {
  return {
    base: stripBaseRef(base.trim()),
    title,
    body,
    draft
  }
}

export function resolveGeneratedPullRequestFieldUpdate(
  seed: GenerationSeed | null,
  latestFields: PullRequestFieldSnapshot,
  requestId: number,
  fields: PullRequestFieldSnapshot
): GeneratedPullRequestFieldUpdate {
  if (
    !seed ||
    seed.requestId !== requestId ||
    seed.base !== latestFields.base ||
    seed.title !== latestFields.title ||
    seed.body !== latestFields.body ||
    seed.draft !== latestFields.draft
  ) {
    return {
      ok: false,
      error: 'Fields changed while generating. Run generate again for a fresh draft.'
    }
  }
  return {
    ok: true,
    fields: {
      base: stripBaseRef(fields.base),
      title: fields.title,
      body: fields.body,
      draft: fields.draft
    }
  }
}
