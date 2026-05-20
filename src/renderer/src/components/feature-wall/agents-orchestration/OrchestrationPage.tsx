import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ChevronDown, Workflow } from 'lucide-react'
import { ClaudeIcon, OpenAIIcon } from '../../status-bar/icons'
import { cn } from '@/lib/utils'
import {
  BUBBLE_FLIGHT_MS,
  BUBBLE_GAP_MS,
  BUBBLE_LAND_MS,
  INITIAL_ROW_MESSAGES,
  INITIAL_ROW_STATE,
  PHASE1_BEATS,
  PHASE2_BEATS,
  SPAWN_CREATING_MS,
  SPAWNED_CLAUDE_INITIAL_MSG,
  SPAWNED_CODEX_INITIAL_MSG,
  type AgentKey,
  type Beat,
  type Phase,
  type RowFlash,
  type RowMessages,
  type RowPending,
  type RowState,
  type SpawnState
} from './orchestration-types'
import { arrowPathFromCoordTo, bubblePathBetweenRows } from './orchestration-bubble-path'
import { AgentRow, WorkspaceCard } from './orchestration-cards'

export function OrchestrationPage(props: { active: boolean; reducedMotion: boolean }): JSX.Element {
  const { active, reducedMotion } = props
  const stageRef = useRef<HTMLDivElement | null>(null)
  const arrowsRef = useRef<SVGSVGElement | null>(null)
  const bubbleLayerRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Partial<Record<AgentKey, HTMLDivElement | null>>>({})

  const [phase, setPhase] = useState<Phase>(1)
  const [spawnState, setSpawnState] = useState<SpawnState>('hidden')
  const [rowState, setRowState] = useState<RowState>(INITIAL_ROW_STATE)
  const [rowMessages, setRowMessages] = useState<RowMessages>(INITIAL_ROW_MESSAGES)
  const [rowFlash, setRowFlash] = useState<RowFlash>({})
  const [rowPending, setRowPending] = useState<RowPending>({
    'spawned-claude': true,
    'spawned-codex': true
  })

  // Why: we need to mutate the rowPending flag at fire-time (before the path
  // gets measured) so the bubble has a real on-screen target. React state
  // updates are asynchronous, so keep a synchronous mirror to flip styles
  // immediately and let the next render reconcile.
  const pendingMirror = useRef<RowPending>({ ...rowPending })
  pendingMirror.current = rowPending

  useEffect(() => {
    if (!active) {
      // Reset everything to the phase-1 initial state when the user pages
      // away so re-entering the step plays from the top.
      setPhase(1)
      setSpawnState('hidden')
      setRowState(INITIAL_ROW_STATE)
      setRowMessages(INITIAL_ROW_MESSAGES)
      setRowFlash({})
      setRowPending({ 'spawned-claude': true, 'spawned-codex': true })
      const arrows = arrowsRef.current
      if (arrows) {
        arrows.innerHTML = ''
      }
      const layer = bubbleLayerRef.current
      if (layer) {
        layer.innerHTML = ''
      }
      return
    }

    if (reducedMotion) {
      // Static end-of-phase-1 state: parent + child both visible, child
      // mid-task. No bubbles, no spawn slot.
      setPhase(1)
      setSpawnState('hidden')
      setRowState(INITIAL_ROW_STATE)
      setRowMessages(INITIAL_ROW_MESSAGES)
      // Draw the phase-1 arrow once so the connector still reads.
      requestAnimationFrame(() => drawArrow('child'))
      return
    }

    let cancelled = false
    const timeouts: number[] = []
    const later = (fn: () => void, ms: number): void => {
      timeouts.push(window.setTimeout(() => !cancelled && fn(), ms))
    }

    const fadeArrows = (): void => {
      const arrows = arrowsRef.current
      if (arrows) {
        arrows.setAttribute('data-fading', 'true')
      }
    }
    const clearArrows = (): void => {
      const arrows = arrowsRef.current
      if (arrows) {
        arrows.innerHTML = ''
      }
    }

    const fireBubble = (beat: Beat): void => {
      const fromRow = rowRefs.current[beat.from]
      const toRow = rowRefs.current[beat.to]
      const stage = stageRef.current
      const layer = bubbleLayerRef.current
      if (!fromRow || !toRow || !stage || !layer) {
        return
      }

      if (beat.senderFinishes) {
        setRowState((s) => ({ ...s, [beat.from]: 'done' }))
      }

      // If the recipient is still pending, snap it to its final geometry
      // synchronously before measuring the path — otherwise the bubble
      // animates to a zero-height collapsed row at the bottom of its card.
      if (pendingMirror.current[beat.to]) {
        toRow.style.transition = 'none'
        toRow.removeAttribute('data-pending')
        // Force layout so the next read sees the final size.
        void toRow.offsetHeight
        toRow.style.transition = ''
        pendingMirror.current = { ...pendingMirror.current, [beat.to]: false }
        setRowPending((p) => ({ ...p, [beat.to]: false }))
      }

      const path = bubblePathBetweenRows(stage, fromRow, toRow)
      const bubble = document.createElement('div')
      bubble.className = 'feature-wall-bubble'
      bubble.style.offsetPath = `path("${path}")`
      bubble.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden>' +
        '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
        '<path d="M3 7l9 6 9-6"/></svg>'
      layer.appendChild(bubble)
      // Force a layout read between the starting state and the animated
      // state so the transition actually plays.
      void bubble.offsetWidth
      requestAnimationFrame(() => bubble.classList.add('in-flight'))

      later(() => {
        const replacement =
          beat.to === 'coord-claude' && beat.coordMsg ? beat.coordMsg : (beat.recipientMsg ?? '')
        if (replacement) {
          setRowMessages((m) => ({ ...m, [beat.to]: replacement }))
          setRowFlash((f) => ({ ...f, [beat.to]: (f[beat.to] ?? 0) + 1 }))
        }
        bubble.classList.remove('in-flight')
        bubble.classList.add('landed')
      }, BUBBLE_FLIGHT_MS)

      later(() => bubble.remove(), BUBBLE_LAND_MS)
    }

    const drawArrow = (target: 'child' | 'spawned'): void => {
      const arrows = arrowsRef.current
      const stage = stageRef.current
      if (!arrows || !stage) {
        return
      }
      arrows.removeAttribute('data-fading')
      const stageRect = stage.getBoundingClientRect()
      arrows.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`)
      arrows.setAttribute('width', String(stageRect.width))
      arrows.setAttribute('height', String(stageRect.height))
      const coordEl = stage.querySelector('[data-feature-wall-card="coord"]')
      const targetEl = stage.querySelector(`[data-feature-wall-card="${target}"]`)
      if (!(coordEl instanceof HTMLElement) || !(targetEl instanceof HTMLElement)) {
        arrows.innerHTML = ''
        return
      }
      const path = arrowPathFromCoordTo(coordEl, targetEl, stageRect)
      arrows.innerHTML = `<path d="${path}"/>`
    }

    const runPhase1 = (done: () => void): void => {
      // The phase-2 → phase-1 transition slides the child card and lineage
      // chip back over ~420ms. Redrawing the arrow now would anchor it to
      // the still-collapsed child geometry. Fade arrows first, switch
      // phase, then redraw against the settled layout.
      fadeArrows()
      clearArrows()
      setPhase(1)
      setRowState(INITIAL_ROW_STATE)
      setRowMessages(INITIAL_ROW_MESSAGES)
      later(() => drawArrow('child'), 460)
      let beatIdx = 0
      const next = (): void => {
        if (beatIdx >= PHASE1_BEATS.length) {
          later(done, 800)
          return
        }
        fireBubble(PHASE1_BEATS[beatIdx])
        beatIdx += 1
        later(next, BUBBLE_GAP_MS)
      }
      later(next, 600)
    }

    const runPhase2 = (done: () => void): void => {
      fadeArrows()
      setPhase(2)
      later(clearArrows, 280)
      // Reset spawned rows to "pending" — they stay collapsed until their
      // dispatch bubble actually lands on each. Reset their state too —
      // last loop ended with codex flipped to a check.
      pendingMirror.current = {
        ...pendingMirror.current,
        'spawned-claude': true,
        'spawned-codex': true
      }
      setRowPending({ 'spawned-claude': true, 'spawned-codex': true })
      setRowState((s) => ({
        ...s,
        'spawned-claude': 'working',
        'spawned-codex': 'working'
      }))
      setRowMessages((m) => ({
        ...m,
        'spawned-claude': SPAWNED_CLAUDE_INITIAL_MSG,
        'spawned-codex': SPAWNED_CODEX_INITIAL_MSG,
        'coord-claude': 'Spawning new workspace…'
      }))
      setRowFlash((f) => ({ ...f, 'coord-claude': (f['coord-claude'] ?? 0) + 1 }))
      setSpawnState('creating')

      later(() => {
        setSpawnState('ready')
        drawArrow('spawned')
        setRowMessages((m) => ({ ...m, 'coord-claude': 'Dispatching sub-tasks…' }))
        setRowFlash((f) => ({ ...f, 'coord-claude': (f['coord-claude'] ?? 0) + 1 }))
      }, SPAWN_CREATING_MS)

      let beatIdx = 0
      const next = (): void => {
        if (beatIdx >= PHASE2_BEATS.length) {
          // Once codex has reported back, claude is wrapping up too — flip
          // its spinner to a check so the cycle ends with both spawned
          // agents visibly done.
          later(() => {
            setRowState((s) => ({ ...s, 'spawned-claude': 'done' }))
            setRowMessages((m) => ({
              ...m,
              'spawned-claude': 'Logs scanned — handing off',
              'coord-claude': 'All sub-tasks complete'
            }))
            setRowFlash((f) => ({
              ...f,
              'spawned-claude': (f['spawned-claude'] ?? 0) + 1,
              'coord-claude': (f['coord-claude'] ?? 0) + 1
            }))
          }, 600)
          // Hold final state, then collapse spawn slot before looping.
          later(() => {
            setSpawnState('hidden')
            later(done, 600)
          }, 2200)
          return
        }
        fireBubble(PHASE2_BEATS[beatIdx])
        beatIdx += 1
        later(next, BUBBLE_GAP_MS)
      }
      later(next, SPAWN_CREATING_MS + 700)
    }

    const loop = (): void => {
      runPhase1(() => runPhase2(() => later(loop, 700)))
    }

    // Wait a frame so cards have measurable layout, then start.
    later(loop, 80)

    const onResize = (): void => {
      // Use a synchronous read of stage dataset so resizes during a phase
      // transition don't fight the in-flight fade.
      const stage = stageRef.current
      if (!stage) {
        return
      }
      if (stage.dataset.phase === '1') {
        drawArrow('child')
      } else if (stage.dataset.phase === '2') {
        drawArrow('spawned')
      }
    }
    window.addEventListener('resize', onResize)

    // Capture the ref node now so the cleanup doesn't read .current after
    // React may have unmounted the layer. Matches the react-hooks
    // exhaustive-deps guidance.
    const cleanupLayer = bubbleLayerRef.current
    return () => {
      cancelled = true
      timeouts.forEach((id) => window.clearTimeout(id))
      window.removeEventListener('resize', onResize)
      if (cleanupLayer) {
        cleanupLayer.innerHTML = ''
      }
    }
  }, [active, reducedMotion])

  return (
    <div
      ref={stageRef}
      data-phase={phase}
      className="feature-wall-orch-stage relative grid"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridAutoRows: 'min-content',
        rowGap: phase === 2 ? 8 : 28,
        paddingRight: 120,
        alignItems: 'start',
        alignContent: 'start',
        height: '100%'
      }}
    >
      <div className="relative flex min-w-0 flex-col gap-2.5">
        <WorkspaceCard
          variant="coordinator"
          name="redesign auth flow"
          dataCard="coord"
          rows={[
            <AgentRow
              key="coord-claude"
              agentKey="coord-claude"
              icon={<ClaudeIcon size={13} />}
              state={rowState['coord-claude']}
              message={rowMessages['coord-claude']}
              flashKey={rowFlash['coord-claude'] ?? 0}
              registerRef={(node) => {
                rowRefs.current['coord-claude'] = node
              }}
            />
          ]}
        />

        <div
          data-feature-wall-collapsible="lineage-chip"
          className="flex justify-start"
          style={{ marginLeft: 28, marginTop: 4, marginBottom: 4 }}
        >
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 text-muted-foreground"
            style={{ height: 18, fontSize: 10, fontWeight: 500 }}
            aria-label="1 child workspace"
          >
            <Workflow className="size-2.5" aria-hidden />
            <span className="truncate">1 child</span>
            <ChevronDown className="size-2.5" aria-hidden />
          </span>
        </div>

        <div
          data-feature-wall-collapsible="child"
          style={{ width: 'calc(100% - 28px)', marginLeft: 'auto' }}
        >
          <WorkspaceCard
            variant="default"
            name="PR 2/4: migrate users.sql"
            dataCard="child"
            childPadding
            rows={[
              <AgentRow
                key="child-codex"
                agentKey="child-codex"
                icon={<OpenAIIcon size={13} />}
                state={rowState['child-codex']}
                message={rowMessages['child-codex']}
                flashKey={rowFlash['child-codex'] ?? 0}
                registerRef={(node) => {
                  rowRefs.current['child-codex'] = node
                }}
              />
            ]}
          />
        </div>
      </div>

      <div
        className={cn('feature-wall-spawn', spawnState !== 'hidden' && 'visible')}
        data-state={spawnState === 'hidden' ? 'creating' : spawnState}
        style={{ display: phase === 1 ? 'none' : undefined }}
      >
        <div className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <span className="feature-wall-spawn-spinner" aria-hidden />
          <span>{spawnState === 'ready' ? 'Workspace ready' : 'Creating workspace…'}</span>
        </div>
        <WorkspaceCard
          variant="default"
          name="audit api error logs"
          dataCard="spawned"
          dimName={spawnState === 'creating'}
          amberDot={spawnState === 'creating'}
          rows={[
            <AgentRow
              key="spawned-claude"
              agentKey="spawned-claude"
              icon={<ClaudeIcon size={13} />}
              state={rowState['spawned-claude']}
              message={rowMessages['spawned-claude']}
              flashKey={rowFlash['spawned-claude'] ?? 0}
              pending={rowPending['spawned-claude']}
              spawnRow
              registerRef={(node) => {
                rowRefs.current['spawned-claude'] = node
              }}
            />,
            <AgentRow
              key="spawned-codex"
              agentKey="spawned-codex"
              icon={<OpenAIIcon size={13} />}
              state={rowState['spawned-codex']}
              message={rowMessages['spawned-codex']}
              flashKey={rowFlash['spawned-codex'] ?? 0}
              pending={rowPending['spawned-codex']}
              spawnRow
              registerRef={(node) => {
                rowRefs.current['spawned-codex'] = node
              }}
            />
          ]}
        />
      </div>

      <svg
        ref={arrowsRef}
        className="feature-wall-orch-arrows"
        aria-hidden
        preserveAspectRatio="none"
      />
      <div
        ref={bubbleLayerRef}
        aria-hidden
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}
      />
    </div>
  )
}
