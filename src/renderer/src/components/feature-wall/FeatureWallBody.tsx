import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { FeatureWallWorkflow } from '../../../../shared/feature-wall-workflows'
import type { FeatureWallOpenSourceTelemetry } from '../../../../shared/telemetry-events'
import type {
  AgentsStep,
  AgentsStepBullet,
  AgentsStepId
} from '../../../../shared/agents-orchestration-steps'
import { cn } from '@/lib/utils'
import { PreviewMedia, RelatedFeatures } from './FeatureWallPreview'
import { TasksAnimatedVisual } from './TasksAnimatedVisual'
import { WorkspacesAnimatedVisual } from './WorkspacesAnimatedVisual'
import { AgentsOrchestrationVisual } from './AgentsOrchestrationVisual'

// Mac users see ⌘/⇧ glyphs, everyone else gets Ctrl+/Shift+ — matches the
// existing convention used elsewhere in the renderer.
const isMacPlatform = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const MOD_KEY_LABEL = isMacPlatform ? '⌘' : 'Ctrl+'
const SHIFT_KEY_LABEL = isMacPlatform ? '⇧' : 'Shift+'

const KBD_CLASS =
  'rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11.5px] text-foreground'

function Bullet(props: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <li className={cn('flex items-start gap-2.5 text-[17px] leading-relaxed', props.className)}>
      <span className="mt-[9px] inline-block size-1.5 shrink-0 rounded-full bg-foreground/40" />
      <span>{props.children}</span>
    </li>
  )
}

function BulletList(props: { bullets: readonly string[] }): JSX.Element {
  return (
    <ul className="flex flex-col gap-3" role="list">
      {props.bullets.map((bullet) => (
        <Bullet key={bullet}>{bullet}</Bullet>
      ))}
    </ul>
  )
}

// Why: agents-orchestration step 3 mentions the `orca` CLI inline. Render the
// markdown-style backticks as monospace chips so the bullet matches the mock,
// without pulling a full markdown renderer in.
function renderInlineCode(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded-[4px] bg-foreground/[0.08] px-1.5 py-px font-mono text-[14px]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function bulletKey(bullet: AgentsStepBullet): string {
  return typeof bullet === 'string' ? bullet : bullet.leadIn
}

function StepBulletList(props: {
  stepId: AgentsStepId
  reducedMotion: boolean
  leadIn?: string
  bullets: readonly AgentsStepBullet[]
}): JSX.Element {
  const { stepId, reducedMotion, leadIn, bullets } = props
  const hasDelayed = bullets.some(
    (b) => typeof b !== 'string' && typeof b.fadeInDelayMs === 'number'
  )
  // Why: keying the wrapper by stepId remounts the component on each step
  // change, so the initial useState below runs again — that prevents the
  // delayed bullet from flashing at full opacity for one paint when
  // navigating from a non-delayed step (Visibility/Usage) into Orchestration.
  return (
    <StepBulletListInner
      key={stepId}
      reducedMotion={reducedMotion}
      hasDelayed={hasDelayed}
      leadIn={leadIn}
      bullets={bullets}
    />
  )
}

function StepBulletListInner(props: {
  reducedMotion: boolean
  hasDelayed: boolean
  leadIn?: string
  bullets: readonly AgentsStepBullet[]
}): JSX.Element {
  const { reducedMotion, hasDelayed, leadIn, bullets } = props
  const [revealed, setRevealed] = useState(() => reducedMotion || !hasDelayed)

  useEffect(() => {
    if (reducedMotion || !hasDelayed) {
      return
    }
    const maxDelay = bullets.reduce((m, b) => {
      if (typeof b === 'string' || b.fadeInDelayMs == null) {
        return m
      }
      return Math.max(m, b.fadeInDelayMs)
    }, 0)
    const id = window.setTimeout(() => setRevealed(true), maxDelay)
    return () => window.clearTimeout(id)
  }, [reducedMotion, hasDelayed, bullets])

  return (
    <div className="flex flex-col gap-3">
      {leadIn ? <p className="text-[16px] leading-relaxed">{leadIn}</p> : null}
      <ul className="flex flex-col gap-3" role="list">
        {bullets.map((bullet) => {
          const delayed = typeof bullet !== 'string' && typeof bullet.fadeInDelayMs === 'number'
          return (
            <Bullet
              key={bulletKey(bullet)}
              className={cn(
                'transition-opacity duration-[420ms] ease-out',
                delayed && !revealed ? 'opacity-0' : 'opacity-100'
              )}
            >
              {typeof bullet === 'string' ? (
                renderInlineCode(bullet)
              ) : (
                <>
                  <strong className="font-semibold">{bullet.leadIn}</strong>{' '}
                  {renderInlineCode(bullet.body)}
                </>
              )}
            </Bullet>
          )
        })}
      </ul>
    </div>
  )
}

function WorkspaceShortcutsCopy(): JSX.Element {
  return (
    <>
      <kbd className={KBD_CLASS}>{MOD_KEY_LABEL}J</kbd> jumps to any workspace;{' '}
      <kbd className={KBD_CLASS}>
        {MOD_KEY_LABEL}
        {SHIFT_KEY_LABEL}↑
      </kbd>{' '}
      /{' '}
      <kbd className={KBD_CLASS}>
        {MOD_KEY_LABEL}
        {SHIFT_KEY_LABEL}↓
      </kbd>{' '}
      moves between them.
    </>
  )
}

export function FeatureWallBody(props: {
  selected: FeatureWallWorkflow
  selectedPresentation: FeatureWallWorkflow
  posterUrl: string | null
  gifUrl: string | null
  showGif: boolean
  prefersReducedMotion: boolean
  source: FeatureWallOpenSourceTelemetry
  agentsActiveStep: AgentsStep | null
}): JSX.Element {
  const {
    selected,
    selectedPresentation,
    posterUrl,
    gifUrl,
    showGif,
    prefersReducedMotion,
    source,
    agentsActiveStep
  } = props
  const isWorkspaces = selected.id === 'workspaces'
  const isTasks = selected.id === 'tasks'
  const isAgents = selected.id === 'agents-orchestration'
  const isAgentsUsage = isAgents && agentsActiveStep?.id === 'usage'
  const hasAnimatedVisual = isWorkspaces || isTasks || isAgents

  const agentsBullets = agentsActiveStep?.bullets ?? null
  const agentsLeadIn = agentsActiveStep?.bulletsLeadIn

  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start gap-7 px-9 pb-9 pt-3',
        hasAnimatedVisual
          ? 'lg:grid-cols-[minmax(0,1fr)_auto]'
          : 'lg:grid-cols-[minmax(0,1fr)_320px]'
      )}
    >
      {hasAnimatedVisual ? (
        <aside className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
          {isAgents && agentsActiveStep ? (
            <div>
              <div className="text-xl font-semibold leading-snug tracking-tight text-foreground">
                {agentsActiveStep.subtitle}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {agentsActiveStep.description}
              </p>
            </div>
          ) : null}
          {isAgents && agentsBullets && agentsActiveStep ? (
            <StepBulletList
              stepId={agentsActiveStep.id}
              reducedMotion={prefersReducedMotion}
              leadIn={agentsLeadIn}
              bullets={agentsBullets}
            />
          ) : (
            <ul className="flex flex-col gap-3" role="list">
              {selectedPresentation.bullets.map((bullet) => (
                <Bullet key={bullet}>{bullet}</Bullet>
              ))}
              {isWorkspaces ? (
                <Bullet>
                  <WorkspaceShortcutsCopy />
                </Bullet>
              ) : null}
            </ul>
          )}
        </aside>
      ) : (
        <PreviewMedia
          key={selected.id}
          posterUrl={posterUrl}
          gifUrl={gifUrl}
          showGif={showGif}
          workflowTitle={selected.title}
        />
      )}

      {hasAnimatedVisual ? (
        <div className="order-1 flex justify-end lg:order-2">
          <div
            className={cn(
              'max-w-full',
              isWorkspaces ? 'w-[440px]' : isAgentsUsage ? 'w-[400px]' : 'w-[520px]'
            )}
          >
            {isWorkspaces ? (
              <WorkspacesAnimatedVisual reducedMotion={prefersReducedMotion} />
            ) : isTasks ? (
              <TasksAnimatedVisual reducedMotion={prefersReducedMotion} />
            ) : agentsActiveStep ? (
              <AgentsOrchestrationVisual
                reducedMotion={prefersReducedMotion}
                activeStepId={agentsActiveStep.id satisfies AgentsStepId}
                widthPx={isAgentsUsage ? 400 : undefined}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <aside className="flex flex-col gap-5">
          <BulletList bullets={selectedPresentation.bullets} />
          {selected.relatedTileIds.length > 0 ? (
            <RelatedFeatures workflow={selected} source={source} />
          ) : null}
        </aside>
      )}
    </div>
  )
}
