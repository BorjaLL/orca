# Mobile Terminal Layout State Machine

Design doc for replacing the four-way split state (`mobileSubscribers[*].wasResizedToPhone`,
`mobileDisplayModes`, `terminalFitOverrides`, `currentDriver`, plus the implicit "actual PTY dims"
in `getTerminalSize`) with a single per-PTY layout state machine and a monotonic sequence-numbered
wire event so the desktop runtime, the mobile xterm, and the desktop renderer can never disagree
about who owns the PTY or what dims it should be at.

## Problem

Today the runtime carries five overlapping pieces of state per PTY that together describe "what
should the PTY look like right now":

- `mobileSubscribers[ptyId][clientId]` — a per-client record that includes `wasResizedToPhone`,
  `viewport`, `previousCols/Rows`, `subscribedAt`, `lastActedAt`.
- `mobileDisplayModes[ptyId]` — the user-selected display mode (`auto` | `phone` | `desktop`).
- `terminalFitOverrides[ptyId]` — a desktop-renderer-facing flag that suppresses safeFit while
  mobile is at phone dims.
- `currentDriver[ptyId]` — `idle` | `desktop` | `mobile{clientId}` from the presence-lock work.
- The actual PTY size (`ptySizes[ptyId]` / `getTerminalSize`) — what node-pty was last told via
  `provider.resize(...)`.

Plus several debounced or timed side channels that mutate the above asynchronously:

- `pendingRestoreTimers` (300 ms debounce on last-subscriber-leaves).
- `pendingSoftLeavers` (250 ms grace before driver flips to idle).
- `resizeSuppressedUntil` (500 ms global window after a desktop-fit transition).
- The desktop renderer's safeFit cascade (IPC → React re-render → rAF → DOM measure → IPC back).
- The mobile xterm's `applyFitScale` frame-retry loop.

Each piece is individually defensible, but together they admit at least seven race conditions
(documented in the investigation notes that triggered this doc) where two pieces of state disagree
and the mobile user sees:

- "Claim worked but the mobile terminal is still zoomed out" — `wasResizedToPhone === true` while
  the PTY is actually at desktop dims (or vice-versa).
- "Release didn't restore the desktop" — `applyMobileDisplayMode` for `auto`/`phone` early-returns
  when `wasResizedToPhone === true` even though the PTY drifted.
- "Pressing the resize button twice fixes it" — the first toggle hits the early-return; the second
  toggle (now with `wasResizedToPhone === false`) actually resizes.
- "Switching tabs back and forth on the phone fixes it" — a fresh `terminal.subscribe` rebuilds
  the whole subscriber record from scratch, papering over the desync.

The structural cause is that **no single function decides "what should the PTY be at right now,"
diffs against current state, and emits exactly one resize plus one wire event**. Every callsite
mutates a subset of the five pieces and hopes the other four catch up.

## Goal

Per PTY, exactly one **target layout state** at any moment:

```ts
type PtyLayoutTarget =
  | { kind: 'desktop'; cols: number; rows: number }
  | { kind: 'phone'; cols: number; rows: number; ownerClientId: string }
```

`desktop` means "the PTY runs at the desktop renderer's pane geometry; mobile (if present)
watches passively." `phone` means "the PTY runs at `ownerClientId`'s viewport; the desktop
renderer's auto-fit is suppressed."

Plus an authoritative current state with a monotonic sequence number per PTY:

```ts
type PtyLayoutState = PtyLayoutTarget & {
  // Monotonically increasing per ptyId. Bumped on every successful transition.
  // Wire events (`resized`, `scrollback`) carry this number so mobile clients
  // can drop stale events that arrive after a newer transition.
  seq: number
  // Wallclock of last successful transition, for debug/telemetry only.
  appliedAt: number
}
```

All transitions go through a single function `applyLayout(ptyId, target)` that:

1. Computes the diff from current state.
2. Calls `ptyController.resize` at most once.
3. Updates all derived state atomically (no other writer touches these maps).
4. Bumps `seq`.
5. Emits exactly one `resized` event on the subscribe stream.
6. Returns the new state synchronously.

Driver state and presence-lock semantics ride on top of this layer unchanged — the mobile-presence
lock spec (`docs/mobile-presence-lock.md`) is **not modified**. Driver flips remain a separate
concern from layout transitions; they happen to share triggers (e.g. `terminal.send` from a mobile
client takes the floor AND can trigger a layout transition) but are distinct outputs.

## Non-goals

- Changing the wire protocol's `terminal.subscribe` / `terminal.send` / `terminal.setDisplayMode`
  / `terminal.updateViewport` shapes beyond adding a `seq` field to the streamed events. Existing
  client builds continue to work; they just lose stale-event filtering.
- Adding a new banner UX or rethinking the take-back flow.
- Touching SSH or local PTY provider code paths.
- Changing the presence-lock model.

## Architecture

The state machine sits inside the Electron main process and is the single point through which
all PTY layout transitions flow. The surrounding actors — desktop renderer, mobile WebView, RPC
methods, daemon-side ptyController — interact with it through narrow, well-defined edges.

```
┌─────────────────────────────┐                  ┌────────────────────────────┐
│ Desktop renderer            │                  │ Mobile WebView (RN)        │
│ (src/renderer/...)          │                  │ (mobile/app, mobile/src)   │
│                             │                  │                            │
│ • mobile-fit-overrides.ts   │                  │ • session/[worktreeId].tsx │
│ • pane safeFit cascade      │                  │ • TerminalWebView          │
│ • Take Back / banner UX     │                  │ • layoutSeqRef stale-drop  │
└─────┬─────────────────▲─────┘                  └─────┬──────────────────▲───┘
      │ pty:resize IPC  │ terminalFitOverrideChanged   │ terminal.* RPC   │ subscribe stream
      │ (renderer→main) │ (main→renderer)              │ (mobile→main)    │ (main→mobile)
      │                 │                              │                  │   scrollback / data
      │                 │                              │                  │   resized {seq}
      ▼                 │                              ▼                  │
┌────────────────────────────────────────────────────────────────────────────┐
│ Electron main process                                                       │
│                                                                              │
│  src/main/runtime/rpc/methods/terminal.ts                                   │
│   subscribe / send / setDisplayMode / updateViewport / unsubscribe          │
│        │                                                                    │
│        ▼                                                                    │
│  OrcaRuntime  (src/main/runtime/orca-runtime.ts)                            │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │ Public triggers:                                                    │   │
│   │   onMobileSubscribe / onMobileTookFloor / onMobileViewportChanged   │   │
│   │   onMobileSetDisplayMode / onDesktopTakeBack /                      │   │
│   │   onLastMobileLeaves / onDesktopGeometryReported / onPtyExit        │   │
│   │                                                                     │   │
│   │   each trigger ── compute target ──▶ enqueue applyLayout(ptyId)     │   │
│   │                                                                     │   │
│   │ Per-PTY async queue (layoutQueues):                                 │   │
│   │   serializes applyLayout calls behind ptyController.resize await    │   │
│   │                                                                     │   │
│   │ applyLayout(ptyId, target):                                         │   │
│   │   • diff currentSize vs target                                      │   │
│   │   • await ptyController.resize  (single point of mutation)          │   │
│   │   • bump layouts[ptyId].seq                                         │   │
│   │   • emit terminalFitOverrideChanged (renderer)                      │   │
│   │   • emit resized {seq} (mobile subscribe stream)                    │   │
│   │                                                                     │   │
│   │ Owned state (only applyLayout writes):                              │   │
│   │   layouts, restoreBaseline*, terminalFitOverrides, ptySizes**       │   │
│   │   *per subscriber, see "Restore baseline"                           │   │
│   │   **via ptyController.resize                                        │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                    │
│        ▼                                                                    │
│  ptyController  (daemon adapter — local node-pty or SSH)                    │
│   • resize(ptyId, cols, rows): Promise<boolean>                             │
└────────────────────────────────────────────────────────────────────────────┘
```

Four data-flow paths cross this boundary:

1. **Mobile-driven layout transition.** mobile WebView → `terminal.send` /
   `terminal.setDisplayMode` / `terminal.updateViewport` → RPC handler → trigger method →
   layoutQueue → applyLayout → ptyController.resize → seq bump → `resized {seq}` back to
   mobile + `terminalFitOverrideChanged` to renderer. The RPC response awaits the queue tail
   so the response is at the correct seq.
2. **Desktop-driven take-back.** renderer "Take Back" button → IPC → `onDesktopTakeBack` →
   layoutQueue → applyLayout → resize to `restoreBaseline` → events to both sides.
3. **Renderer geometry report (passive, layout=desktop).** renderer pane safeFit → `pty:resize`
   IPC → `onExternalPtyResize` (gated by `isResizeSuppressed`) → updates `restoreBaseline`
   only, no resize emitted (PTY is already at the reported size; the renderer is reporting,
   not requesting). If layout is `phone`, the report is recorded for future restore but does
   not call applyLayout.
4. **Disconnect / PTY exit cleanup.** WS close → `onClientDisconnected` → if last subscriber,
   enqueue applyLayout to `desktop` (or schedule via `pendingRestoreTimers`). PTY exit →
   `onPtyExit` clears all per-PTY state and short-circuits any pending queued work.

## State machine

### States

Two stable states (`desktop`, `phone`) plus a one-frame transient (`transitioning`) used only as
an internal critical-section marker — never observable on the wire because `applyLayout` is
synchronous on the runtime thread.

Initial state for a PTY when no mobile client has ever subscribed: `desktop` with cols/rows
captured from the spawn-time pty geometry.

### Inputs (transition triggers)

The runtime exposes one method per trigger. Each one synchronously computes the new target,
calls `applyLayout`, and returns. They do **not** directly mutate `mobileSubscribers`,
`mobileDisplayModes`, `terminalFitOverrides`, or `ptySizes` — only `applyLayout` does.

| Trigger | Method | Effect on target |
|---|---|---|
| Mobile fresh subscribe with `displayMode='auto'` and viewport | `onMobileSubscribe(ptyId, clientId, viewport, mode)` | target = `phone(viewport, clientId)` |
| Mobile fresh subscribe with `displayMode='desktop'` | `onMobileSubscribe(ptyId, clientId, viewport, 'desktop')` | target unchanged (passive watch) |
| Mobile sends keystroke (`terminal.send` with `client.type='mobile'`) | `onMobileTookFloor(ptyId, clientId)` | if currently `desktop`, target = `phone(thatClient's viewport, thatClient)`. If already `phone` with a different owner, target = `phone(thatClient's viewport, thatClient)`. |
| Mobile updates viewport (`terminal.updateViewport`) | `onMobileViewportChanged(ptyId, clientId, viewport)` | if `phone{clientId}`, target = `phone(viewport, clientId)`. Otherwise no-op (record viewport for next take-floor). |
| Mobile sets display mode | `onMobileSetDisplayMode(ptyId, clientId, mode)` | `auto` ⇒ target = `phone(viewport, clientId)`. `desktop` ⇒ target = `desktop(restoreCols, restoreRows)`. |
| Desktop "Take Back" | `onDesktopTakeBack(ptyId)` | target = `desktop(restoreCols, restoreRows)`. |
| Last mobile subscriber leaves | `onLastMobileLeaves(ptyId)` | After 300 ms debounce, if no peer rejoined: target = `desktop(restoreCols, restoreRows)`. |
| Desktop renderer reports its actual pane geometry | `onDesktopGeometryReported(ptyId, cols, rows)` | If currently `desktop`, target = `desktop(cols, rows)`. If `phone`, just record for future restore. |
| PTY exits | `onPtyExit(ptyId)` | clear all per-PTY state. |

`restoreCols/Rows` is computed from the per-PTY **restore baseline** (see "Restore baseline"
below). `viewport` for `phone` targets is sourced from the most-recent-actor's stored viewport.

#### onMobileViewportChanged pseudocode

The keyboard show/hide path is the highest-frequency trigger and the one most likely to
regress under the rewrite — today's `updateMobileViewport` is ~70 lines and mutates five maps.
After:

```ts
async onMobileViewportChanged(
  ptyId: string,
  clientId: string,
  viewport: { cols: number; rows: number }
): Promise<void> {
  const inner = this.mobileSubscribers.get(ptyId)
  const sub = inner?.get(clientId)
  if (!sub) return

  // Always record the latest viewport, even if this client isn't the
  // current owner. Future take-floor by this client uses this value.
  sub.viewport = viewport
  sub.lastActedAt = Date.now()

  const mode = this.mobileDisplayModes.get(ptyId) ?? 'auto'
  if (mode === 'desktop') return  // passive watch; no resize

  // Pick whose viewport drives the layout. Today: most-recent-actor across
  // all subscribers. The actor may not be `clientId` (another phone could
  // have taken the floor between this update arriving and being processed).
  const driver = this.pickMostRecentActor(ptyId)
  if (!driver) return

  const target: PtyLayoutTarget = {
    kind: 'phone',
    cols: driver.viewport.cols,
    rows: driver.viewport.rows,
    ownerClientId: driver.clientId,
  }
  await this.enqueueLayout(ptyId, target)
}
```

If the picked driver's viewport equals the current layout dims (common: keyboard didn't
actually change height), `applyLayout` short-circuits — `dimsChanged === false`, no resize
call, but seq still bumps and the wire event is emitted (so the mobile xterm re-fits
defensively). The owner-clientId mismatch with the keyboard-event source is intentional:
viewport updates are informational for non-owners and only steer the PTY when the sender is
also the most-recent-actor.

#### onClientDisconnected pseudocode

The disconnect path is the second-trickiest trigger after `onMobileViewportChanged`: it has
four distinct sub-cases (cancel pending timers, promote any soft-leave grace, restore
last-leaver PTYs, re-elect driver where peers survived). Today's implementation (~lines
1431–1545 in `orca-runtime.ts`) directly mutates `ptyController`, `terminalFitOverrides`,
and emits events from each sub-case independently, plus a fifth legacy
`terminalFitOverrides` cleanup branch — the exact multi-writer pattern this design is
replacing. After the rewrite, every PTY-mutating sub-case routes through `enqueueLayout`;
the disconnect handler itself only does subscriber-map bookkeeping and driver flips, and
the legacy fifth branch becomes dead code.

```ts
async onClientDisconnected(clientId: string): Promise<void> {
  // (1) Cancel pending restore-debounce timers owned by this client.
  // The client is gone; the debounce target (300 ms last-leaver restore)
  // is meaningless and would race with the immediate path below.
  for (const [ptyId, entry] of this.pendingRestoreTimers) {
    if (entry.clientId === clientId) {
      clearTimeout(entry.timer)
      this.pendingRestoreTimers.delete(ptyId)
    }
  }

  // (2) Promote any soft-leave grace owned by this client into immediate
  // finalization. Grace existed to absorb a quick re-subscribe; a real
  // disconnect kills any chance of re-subscribe, so we run the
  // grace-fire path now rather than after 250 ms.
  for (const [ptyId, soft] of this.pendingSoftLeavers) {
    if (soft.clientId !== clientId) continue
    clearTimeout(soft.timer)
    this.pendingSoftLeavers.delete(ptyId)

    // Cancel any 300 ms restore timer too — we'll do it inline.
    const pending = this.pendingRestoreTimers.get(ptyId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingRestoreTimers.delete(ptyId)
    }

    // The grace held the inner-map empty already, so the layout
    // transition target is unconditionally `desktop` if the layout
    // is currently `phone`. (If layout is already `desktop`, the
    // call is a no-op via applyLayout's idempotency.)
    const cur = this.layouts.get(ptyId)
    if (cur?.kind === 'phone') {
      const restore = this.resolveDesktopRestoreTarget(ptyId)
      // Ignore the result — the client is gone, no one is awaiting
      // an RPC response. A pty-exited or resize-failed outcome is
      // logged inside applyLayout and self-recovers on the next
      // user gesture.
      void this.enqueueLayout(ptyId, {
        kind: 'desktop',
        cols: restore.cols,
        rows: restore.rows,
      })
    }
    this.setDriver(ptyId, { kind: 'idle' })
  }

  // (3) Immediate restore for PTYs where this client was the last
  // mobile subscriber. With multi-mobile, peer subscribers keep the
  // floor; only when the inner map empties do we transition to
  // desktop. We split into two passes (collect first, mutate second)
  // so the iteration is stable across the inner-map deletes.
  const ptysWithSurvivingPeers: string[] = []
  const ptysToRestore: string[] = []
  for (const [ptyId, inner] of this.mobileSubscribers) {
    if (!inner.has(clientId)) continue
    inner.delete(clientId)
    if (inner.size > 0) {
      ptysWithSurvivingPeers.push(ptyId)
    } else {
      this.mobileSubscribers.delete(ptyId)
      ptysToRestore.push(ptyId)
    }
  }
  for (const ptyId of ptysToRestore) {
    const cur = this.layouts.get(ptyId)
    if (cur?.kind === 'phone') {
      const restore = this.resolveDesktopRestoreTarget(ptyId)
      void this.enqueueLayout(ptyId, {
        kind: 'desktop',
        cols: restore.cols,
        rows: restore.rows,
      })
    }
    this.setDriver(ptyId, { kind: 'idle' })
  }

  // (4) Driver re-election where peers survived. If the disconnecting
  // client was the active driver, the most-recent surviving actor
  // takes the floor. The new driver may have a different viewport,
  // so we enqueue a phone target with their dims — applyLayout
  // short-circuits on dimsChanged===false if the viewport matches.
  for (const ptyId of ptysWithSurvivingPeers) {
    const driver = this.getDriver(ptyId)
    if (driver.kind !== 'mobile' || driver.clientId !== clientId) continue
    const next = this.pickMostRecentActor(ptyId)
    if (!next) continue
    this.setDriver(ptyId, { kind: 'mobile', clientId: next.clientId })

    const mode = this.mobileDisplayModes.get(ptyId) ?? 'auto'
    if (mode === 'desktop') continue  // passive watch — no resize
    void this.enqueueLayout(ptyId, {
      kind: 'phone',
      cols: next.viewport.cols,
      rows: next.viewport.rows,
      ownerClientId: next.clientId,
    })
  }

  // Sub-case (5) — legacy resizeForClient callers. Older mobile builds use
  // the `terminal.resizeForClient` RPC directly and never populate
  // `mobileSubscribers`. They DO get an entry in `terminalFitOverrides`
  // (applyLayout writes it on every kind:'phone' transition) carrying the
  // owning clientId. We walk the overrides map for entries owned by the
  // disconnecting client where mobileSubscribers has no matching entry, and
  // restore the layout. Without this branch, an old phone disconnecting
  // would leave the PTY phone-fitted forever.
  //
  // Note: this also acts as a defense-in-depth assertion for the invariant
  // "applyLayout is the sole writer of terminalFitOverrides ⟺ a matching
  // mobileSubscribers entry exists". A violation would surface as a
  // restore that didn't fire (rather than silent stale state).
  for (const [ptyId, override] of terminalFitOverrides) {
    if (override.clientId !== clientId) continue
    if (mobileSubscribers.has(ptyId)) continue
    const cur = layouts.get(ptyId)
    if (cur?.kind !== 'phone') continue
    const fallback = resolveDesktopRestoreTarget(ptyId)
    enqueueLayout(ptyId, {
      kind: 'desktop',
      cols: override.previousCols ?? fallback.cols,
      rows: override.previousRows ?? fallback.rows,
    })
  }
}
```

Notes on the rewrite:

- **`resolveDesktopRestoreTarget(ptyId)`** is the four-step fallback chain defined in the
  Helpers section above. Always returns `{cols, rows}`; the chain's terminal branch
  (`{80,24}`) guarantees a value, so the disconnect handler never has to defend against
  `null`.
- **`void this.enqueueLayout(...)`** — disconnect callers do not await. The disconnect
  itself is fire-and-forget (the WS is gone), and awaiting would block the disconnect
  handler on a queued resize that might be slow over SSH. Failures inside `applyLayout`
  log + self-heal on the next gesture; nothing observable ever depends on a disconnect-
  triggered enqueue resolving.
- **Driver flips happen synchronously**, before `enqueueLayout`. Driver state is
  decoupled from layout state (per the architecture diagram); `setDriver` writes to
  `currentDriver` directly and does not depend on the layout queue.
- **Sub-case ordering is for clarity, not concurrency.** The handler body has zero
  `await` statements before its sub-cases run, so the entire body executes in a single
  synchronous turn — no setTimeout callback can interleave mid-iteration. Sub-case (1)
  cancels deferred work first, then (2)/(3) drive new work, then (4) re-elects, in
  reading order. Reordering the sub-cases would not introduce a race; it would just
  hurt readability.
- **Why `cur?.kind === 'phone'` guards before enqueue**: the disconnect handler may run
  for a client that was never the active phone-fit owner (e.g. it subscribed with
  `mode='desktop'` and only watched passively). Skipping the enqueue when the layout
  is already `desktop` avoids spurious seq bumps and wire events for non-owners.
- **Sub-case (2) is mode-decoupled.** The pendingSoftLeavers promotion
  restores any PTY whose layout is `phone` and whose last mobile
  subscriber just disconnected, regardless of stored display mode.
  Originally relevant when the wire enum included a sticky-phone mode; now
  that 'phone' has been collapsed out of the request schema, the simpler
  rule ("no subscriber ⇒ layout converges to desktop") is the only rule
  that fires.

### Helpers

The pseudocode below references four helper methods on the runtime. Each is private and pure
with respect to the runtime's owned maps (no side effects beyond reads).

`isFreshSubscribe(ptyId: string): boolean` — returns `true` iff `handleMobileSubscribe` is
currently mid-flight for `ptyId` and has flagged this PTY as expecting its very first
`enqueueLayout` call. It exists solely so `enqueueLayout`'s "no layouts entry" short-circuit
doesn't fire on the very first transition for a PTY, where the entry doesn't exist yet
*because* we're about to create it. Storage:

```ts
private freshSubscribeGuard = new Set<string>()
```

`handleMobileSubscribe` adds `ptyId` to the set synchronously (before the `enqueueLayout`
call), and removes it in a `finally` block after the `await enqueueLayout(...)` resolves:

```ts
this.freshSubscribeGuard.add(ptyId)
try {
  result = await this.enqueueLayout(ptyId, target)
} finally {
  this.freshSubscribeGuard.delete(ptyId)
}
```

`isFreshSubscribe(ptyId)` is the one-line `return this.freshSubscribeGuard.has(ptyId)`.

`pickEarliestRestoreBaseline(ptyId: string): { cols: number; rows: number } | null` — iterates
`this.mobileSubscribers.get(ptyId)` and returns the `{ cols, rows }` pair from the subscriber
with the smallest `subscribedAt` whose `restoreBaselineCols` and `restoreBaselineRows` are both
non-null. Returns the cols and rows together so callers cannot accidentally combine cols from
one subscriber's baseline with rows from another's. Returns `null` if no subscriber has a
captured baseline; callers fall back to the chain documented in "Restore baseline."

`pickMostRecentActor(ptyId: string): Subscriber | null` — iterates the inner map for `ptyId`
and returns the subscriber with the largest `lastActedAt`, or `null` if the map is empty or
absent. Used by `onMobileViewportChanged` and `onMobileTookFloor` to decide whose viewport
drives the next phone target.

`resolveDesktopRestoreTarget(ptyId: string): { cols: number; rows: number }` — the four-step
fallback chain spec'd in "Restore baseline," wrapped as a single helper so every callsite
that builds a `desktop` target uses the same logic and cannot drift from it:

1. `pickEarliestRestoreBaseline(ptyId)` — earliest-by-`subscribedAt` non-null subscriber baseline.
2. `lastRendererSizes.get(ptyId)` — most-recent desktop renderer geometry report.
3. `getTerminalSize(ptyId)` — current PTY dims.
4. `{ cols: 80, rows: 24 }` — hard default; only reachable under bug.

Returns `{cols, rows}` always; the terminal branch (4) guarantees a value. Callers
(`onMobileSetDisplayMode` desktop branch, `onDesktopTakeBack`, `onLastMobileLeaves`,
`onClientDisconnected`'s sub-cases 2/3/5, the soft-leave-promotion path) use this helper
exclusively; no callsite re-implements the chain inline.

### applyLayout

`ptyController.resize` is async (the daemon adapter awaits SSH/local round-trips). If two
trigger methods both call `applyLayout` and interleave around the await, the seq bumped by the
later call can be observed on the wire **before** the earlier call's resize has actually been
applied — defeating the seq-as-truth promise. To prevent that, every trigger method enqueues
its applyLayout work onto a per-PTY async queue. Inside the queue, applyLayout runs
fully serially: diff → await resize → bump seq → emit events. The seq the wire sees is the seq
that matches the PTY's actual current dims.

```ts
private layouts = new Map<string, PtyLayoutState>()

// Result type returned by both applyLayout and enqueueLayout. Callers
// (especially the RPC layer) need to distinguish "we shipped a new state
// at seq N" from "we did nothing — caller should not claim a seq it didn't
// produce." The reason field tells the caller whether to retry or give up.
type ApplyLayoutResult =
  | { ok: true; state: PtyLayoutState }
  | { ok: false; reason: 'pty-exited' | 'resize-failed' }

// Per-PTY queue slots. See "enqueueLayout coalescing" below for the
// 2-slot invariant on coalesce-eligible targets and the appended-task
// path used when a non-coalesce-eligible target arrives.
interface LayoutQueueEntry {
  // The currently-running applyLayout, if any.
  running: Promise<ApplyLayoutResult> | null
  // FIFO of deferred targets. Coalesce-eligible viewport tail can
  // collapse into a single slot (see coalescing rule below); a
  // non-eligible target is appended as a new slot. Length is bounded
  // by user-gesture frequency in practice.
  pending: Array<{
    target: PtyLayoutTarget
    // Resolvers from every caller whose enqueue resolved into this slot.
    // When the slot runs, all of them resolve with the same result.
    waiters: Array<(r: ApplyLayoutResult) => void>
  }>
}
private layoutQueues = new Map<string, LayoutQueueEntry>()

private enqueueLayout(ptyId: string, target: PtyLayoutTarget): Promise<ApplyLayoutResult> {
  // PTY-exit short-circuit. The fresh-subscribe gate lets the very first
  // transition through even though layouts has no entry yet.
  if (!this.layouts.has(ptyId) && !this.isFreshSubscribe(ptyId)) {
    return Promise.resolve({ ok: false, reason: 'pty-exited' })
  }

  let entry = this.layoutQueues.get(ptyId)
  if (!entry) {
    entry = { running: null, pending: [] }
    this.layoutQueues.set(ptyId, entry)
  }

  return new Promise<ApplyLayoutResult>((resolve) => {
    if (!entry!.running) {
      // Nothing running — start immediately.
      entry!.running = this.runLayoutSlot(ptyId, target, [resolve])
      return
    }
    const tail = entry!.pending[entry!.pending.length - 1]
    if (tail && this.coalescesWith(tail.target, target)) {
      // Coalesce: replace the deferred tail's target with this newer one.
      // The original caller's promise piggybacks onto whatever runs next,
      // so they observe the eventually-applied state — not their target.
      tail.target = target
      tail.waiters.push(resolve)
      return
    }
    // Non-coalesce-eligible (mode flip, take-floor, take-back, or a
    // different-owner phone target): append as a new slot.
    entry!.pending.push({ target, waiters: [resolve] })
  })
}

// Coalescing rule: a new viewport-only update from the same owner
// supersedes a queued tail with the same target shape. Anything else
// (mode flip, owner change, take-back) appends — losing a take-floor
// to a viewport tick would be a fairness hole.
private coalescesWith(prev: PtyLayoutTarget, next: PtyLayoutTarget): boolean {
  if (prev.kind !== next.kind) return false
  if (prev.kind === 'phone' && next.kind === 'phone') {
    return prev.ownerClientId === next.ownerClientId
  }
  return true  // both 'desktop': dim-only refresh is coalesce-eligible
}

// Runs a single applyLayout, then promotes the next pending slot if any.
// Invariant: at most one runLayoutSlot is in flight per ptyId at any time.
// The pending FIFO is bounded in practice by user-gesture frequency
// (mode flips, owner changes); coalesce-eligible viewport storms collapse
// into a single tail slot, preserving the 2-slot bound for that case.
private async runLayoutSlot(
  ptyId: string,
  target: PtyLayoutTarget,
  waiters: Array<(r: ApplyLayoutResult) => void>,
): Promise<ApplyLayoutResult> {
  let result: ApplyLayoutResult
  try {
    result = await this.applyLayout(ptyId, target)
  } catch (err) {
    this.log?.error?.('applyLayout threw', { ptyId, err })
    result = { ok: false, reason: 'resize-failed' }
  }
  for (const w of waiters) w(result)

  const entry = this.layoutQueues.get(ptyId)
  if (!entry) return result
  const next = entry.pending.shift()
  if (next) {
    entry.running = this.runLayoutSlot(ptyId, next.target, next.waiters)
  } else {
    entry.running = null
    // Drop the entry once both running and pending are empty so the
    // map doesn't grow without bound across short-lived PTYs.
    this.layoutQueues.delete(ptyId)
  }
  return result
}

private async applyLayout(
  ptyId: string,
  target: PtyLayoutTarget
): Promise<ApplyLayoutResult> {
  const prev = this.layouts.get(ptyId)
  const seq = (prev?.seq ?? 0) + 1
  const next: PtyLayoutState = { ...target, seq, appliedAt: Date.now() }

  const currentSize = this.getTerminalSize(ptyId)
  const dimsChanged =
    currentSize?.cols !== target.cols || currentSize?.rows !== target.rows
  const modeChanged =
    (prev?.kind ?? 'desktop') !== target.kind

  // Snapshot the maps we are about to write so we can roll back on resize
  // failure. layouts is captured by value above; for restoreBaseline /
  // terminalFitOverrides we capture the previous entries (or "absent")
  // before mutating so we can put them back exactly.
  const prevFitOverride = this.terminalFitOverrides.get(ptyId) ?? null
  const prevLayoutEntry = prev ?? null

  // Tentative writes — the resize is the point of no return.
  this.layouts.set(ptyId, next)
  if (target.kind === 'phone') {
    // The fit-override is a renderer-facing flag; the canonical baseline
    // lives on each subscriber's restoreBaselineCols/Rows. Pull cols+rows
    // atomically from the same subscriber so they can't desync.
    const baseline = this.pickEarliestRestoreBaseline(ptyId)
    this.terminalFitOverrides.set(ptyId, {
      mode: 'mobile-fit',
      cols: target.cols,
      rows: target.rows,
      previousCols: baseline?.cols ?? null,
      previousRows: baseline?.rows ?? null,
      updatedAt: next.appliedAt,
      clientId: target.ownerClientId,
    })
  } else {
    this.terminalFitOverrides.delete(ptyId)
  }

  if (dimsChanged) {
    let ok = false
    try {
      ok = (await this.ptyController?.resize?.(ptyId, target.cols, target.rows)) ?? true
    } catch (err) {
      ok = false
      this.log?.error?.('ptyController.resize threw', { ptyId, err })
    }
    if (!ok) {
      // Roll back to the pre-call snapshot. The seq is NOT bumped on the
      // wire because we never emit below.
      if (prevLayoutEntry) {
        this.layouts.set(ptyId, prevLayoutEntry)
      } else {
        this.layouts.delete(ptyId)
      }
      if (prevFitOverride) {
        this.terminalFitOverrides.set(ptyId, prevFitOverride)
      } else {
        this.terminalFitOverrides.delete(ptyId)
      }
      return { ok: false, reason: 'resize-failed' }
    }
    this.resizeHeadlessTerminal(ptyId, target.cols, target.rows)
  }

  // Emit fit-override-changed only when the *mode* flips. Layouts can change
  // dims without flipping mode (e.g. keyboard show/hide while phone), and we
  // don't want every viewport tick to wake the renderer.
  if (modeChanged) {
    // Phone→desktop: arm the renderer-cascade suppress window before the
    // collateral safeFit IPCs arrive. See "Renderer cascade suppression".
    if (target.kind === 'desktop') this.suppressResizesForMs(500)
    this.notifier?.terminalFitOverrideChanged(
      ptyId,
      target.kind === 'phone' ? 'mobile-fit' : 'desktop-fit',
      target.cols,
      target.rows,
    )
  }

  // Mobile-facing event always fires (phone clients need to re-fit on every
  // dim change, not just mode flips).
  this.notifyTerminalResize(ptyId, {
    cols: target.cols,
    rows: target.rows,
    displayMode: target.kind === 'phone' ? 'phone' : 'desktop',
    reason: 'apply-layout',
    seq,
  })

  return { ok: true, state: next }
}
```

#### enqueueLayout coalescing

`enqueueLayout` is **not** an unbounded FIFO for the high-frequency case. Android keyboard
show/hide can emit 10–15 viewport updates over ~250 ms, and each `applyLayout` awaits
`ptyController.resize` (~30–80 ms over SSH). A naive FIFO queues 300 ms–1.2 s of work that
the RPC response also waits on. Coalescing keeps tail latency bounded at ≤ 2× a single
applyLayout duration for that case.

Coalescing is **selective**, gated by `coalescesWith(prev, next)`:

- **Coalesce-eligible**: the new target's `kind` matches the queued tail's `kind`, and (for
  `phone` targets) the `ownerClientId` matches. This is the actual high-frequency case: a
  single owner's keyboard-show/hide viewport ticks, or repeated desktop dim refreshes from
  the renderer cascade.
- **Not coalesce-eligible**: mode flips (`phone` ↔ `desktop`), take-floor / take-back, or a
  phone target whose `ownerClientId` differs from the queued tail's owner. These are
  semantic transitions, not noise — collapsing them would lose a user gesture (e.g. one
  phone's Take Floor button could silently do nothing if a competing phone's update
  superseded it).

When `enqueueLayout(ptyId, target)` is called:

1. **No task running.** Start `target` immediately as the running slot.
2. **One task running, pending FIFO empty.** Append `target` as the first deferred slot.
3. **One task running, pending FIFO has a tail.**
   - If `coalescesWith(tail.target, target)` is `true`: **replace** the tail's target with
     `target`. The superseded caller's promise piggybacks onto whatever runs next, resolving
     with the result of the *replaced* task. Both callers' waiters are carried in the same
     slot's `waiters` array and resolve with the same `ApplyLayoutResult`.
   - Otherwise: **append** `target` as a new slot at the tail of the FIFO. The pending FIFO
     grows beyond one slot in this case.

The invariant is: **at most 2 task slots per ptyId for coalesce-eligible targets** (one
running plus one deferred tail that absorbs same-owner viewport storms). Appended tasks for
non-coalesce-eligible targets queue beyond that bound, but they are bounded in practice by
user-gesture frequency (mode-toggle taps, take-floor/take-back presses, multi-phone
hand-offs), not by keyboard animation rates — not a perf concern.

The contract every RPC caller observes is: "your update was honored, or it was superseded by
a more-recent update from the same client with the same target shape." A caller whose
intermediate viewport got coalesced away sees, in their RPC response, the seq of whatever
final target was actually applied. This is sound for the high-frequency triggers —
`onMobileViewportChanged` (keyboard show/hide) and `onDesktopGeometryReported` (renderer
cascade) — because the only consumer who cares about the intermediate frames is the
keyboard animation, and the keyboard animation emits the *next* update before the previous
one would have rendered anyway. Take-floor and mode-flip callers, by contrast, see their
target run as a distinct slot with its own seq, even if a coalesce-eligible tail is queued
before them.

Mode flips (`onMobileSetDisplayMode`, `onDesktopTakeBack`), take-floor, take-back, and
last-leaver are intrinsically rate-limited by user gesture or by the existing 250 ms /
300 ms debounces. The pending FIFO almost always has 0 or 1 slot in those cases; appended
slots beyond 1 only appear under contrived multi-phone rapid-gesture stress, and each one
runs in order.

The rollback path on `ptyController.resize` failure runs inside the actually-running slot —
the failure rolls back that target's tentative writes and resolves all current waiters with
`{ ok: false, reason: 'resize-failed' }`. Any pending slots are unaffected and the next one
starts fresh on the following tick with its own snapshot of `prev`.

Trigger methods become `async` and `await this.enqueueLayout(...)`. Mobile RPC handlers in
`src/main/runtime/rpc/methods/terminal.ts` (`terminal.send`, `terminal.setDisplayMode`,
`terminal.subscribe`, `terminal.updateViewport`) await the queue tail before sending the RPC
response so the response always reflects the seq that has actually shipped to the wire.
Concretely:

```ts
async function terminalSetDisplayMode(req) {
  const result = await runtime.onMobileSetDisplayMode(req.ptyId, req.clientId, req.mode)
  if (!result.ok) {
    // Propagate the discriminator so the mobile client can decide whether
    // to retry, drop the subscription, or surface a toast. Reading
    // runtime.layouts here would lie: rollback / pty-exited cases left
    // the seq either at its old value or absent entirely.
    return { ok: false, reason: result.reason }
  }
  // result.state.seq is exactly the seq emitted on the mobile subscribe
  // stream's `resized` event for this transition; monotonicity is preserved.
  return { ok: true, seq: result.state.seq }
}
```

The reason discriminator's client-side semantics are documented under "Mobile ← server (RPC
response shape)" in the Wire protocol changes section.

On PTY exit, `onPtyExit` does `this.layouts.delete(ptyId); this.layoutQueues.delete(ptyId)`.
Any work already chained onto the (now-detached) tail will run, but every `applyLayout` checks
`this.layouts.has(ptyId)` (or that the call is a fresh subscribe creating the entry) and
short-circuits if the PTY is gone, so no resize is issued against a dead pty handle.

### Restore baseline

The restore baseline answers "if we transition to `desktop` right now, what dims should we
restore the PTY to?" It is **per-subscriber**, not per-PTY, on purpose: when a second mobile
client (e.g. an iPad) joins a PTY that's already phone-fitted, it must capture `null` (skip
capture) so the *first* subscriber's pre-mobile baseline survives. A per-PTY single-slot
baseline would let the iPad overwrite the phone's baseline with the already-shrunk phone dims,
and the next desktop transition would restore to the wrong size.

Each `Subscriber` record carries:

```ts
interface Subscriber {
  clientId: string
  viewport: { cols: number; rows: number }
  subscribedAt: number
  lastActedAt: number
  // Pre-mobile-fit PTY dims captured at this subscriber's first auto/phone
  // subscribe. null when this subscriber joined while another mobile client
  // had already phone-fitted the PTY (no pristine baseline to capture).
  // Renamed from previousCols / previousRows for clarity.
  restoreBaselineCols: number | null
  restoreBaselineRows: number | null
}
```

The desktop-restore target is picked through a four-step fallback chain. Every callsite that
needs to compute a `desktop` target (last-leaver debounce, take-back, mode-flip-to-desktop,
soft-leave promotion) walks the chain in this exact order, taking the first non-null result:

1. **`pickEarliestRestoreBaseline(ptyId)`** — the earliest-by-`subscribedAt` subscriber with
   a non-null `restoreBaselineCols/Rows` pair. The earliest non-null capture is the genuine
   pre-mobile geometry; later joiners whose baseline is `null` are passed over.
2. **`lastRendererSizes.get(ptyId)`** — the most-recent desktop renderer report (set by
   `onDesktopGeometryReported`). Covers the case where every subscriber's baseline is `null`
   (e.g. mobile subscribed with `mode='desktop'` and never captured) but the renderer has
   reported its actual pane geometry at least once.
3. **`getTerminalSize(ptyId)`** — the PTY's actual current dims. Always available while the
   PTY is running; this is the size node-pty believes it has right now. Acceptable as a
   restore target because if we're transitioning to `desktop`, "do nothing" (resize to current
   dims) is a valid outcome — the renderer will fit-cascade to its real pane geometry on the
   next safeFit and report the correct size via path (2) for future restores.
4. **`{ cols: 80, rows: 24 }`** — a hard default. Catastrophic; should never reach this branch
   in practice (the PTY is running, so step 3 is always available). Defined explicitly so the
   behavior under bug is "land on a sane default" rather than "throw or no-op silently."

This chain is wrapped in the `resolveDesktopRestoreTarget(ptyId)` helper (defined in
"Helpers"); every callsite that needs a desktop-restore target calls that helper rather
than re-implementing the chain inline.

Writes to subscriber baselines now flow through `applyLayout` indirectly:

- A fresh mobile subscribe with `mode=auto/phone` captures the current PTY size into its own
  subscriber record's `restoreBaselineCols/Rows` *before* enqueuing applyLayout. If another
  subscriber on the same PTY already has a non-null baseline, the new subscriber's baseline
  stays `null` (the existing baseline is the canonical one).
- `onDesktopGeometryReported` (today's `onExternalPtyResize`) while the layout is `desktop`
  refreshes `restoreBaselineCols/Rows` on every subscriber whose existing baseline is
  non-null — those baselines now point at the renderer-current dims, not the stale spawn-time
  size. Subscribers with `null` baselines stay `null`. This is the **only** path that mutates
  baselines after subscribe; applyLayout itself does not write subscriber baselines.

The restore baseline is **not** touched by transient renderer cascades during the
resize-suppress window — see "Renderer cascade suppression" below.

## Wire protocol changes

Backward-compatible additive change to the streamed event payloads.

### Server → mobile (subscribe stream)

Today:
```ts
emit({ type: 'scrollback', lines, truncated, serialized, cols, rows, displayMode })
emit({ type: 'data', chunk })
emit({ type: 'resized', cols, rows, serialized, displayMode, reason })
emit({ type: 'end' })
```

After:
```ts
emit({ type: 'scrollback', lines, truncated, serialized, cols, rows, displayMode, seq })
emit({ type: 'data', chunk })
emit({ type: 'resized', cols, rows, serialized, displayMode, reason, seq })
emit({ type: 'end' })
```

`seq` is the value of `layouts[ptyId].seq` at the moment the event was emitted. Mobile clients
track the highest `seq` they have applied per PTY and **drop** any `scrollback`/`resized` event
whose `seq` is less than or equal to the highest applied. This is the entire stale-event filter.

If the PTY has never transitioned (no prior `enqueueLayout` call), `seq` on the first
`scrollback` is `undefined` and the mobile filter's fail-open path applies — the event is
applied unconditionally. Subsequent `resized` events carry `seq` starting at 1 from the first
transition. A passive (`mode='desktop'`) subscribe to a PTY that has previously transitioned
receives the current `layouts[ptyId].seq` on its `scrollback`, treating it as the established
high-water mark; future `resized` events for that PTY use higher seqs and the passive
subscriber's filter behaves the same as an active one's.

`data` events carry no `seq` because they are byte-level pass-through and ordering is preserved
by the underlying WS stream.

### Server → renderer (existing IPC)

`terminalFitOverrideChanged` is unchanged on the wire. Internally it now carries a derived
representation of the layout state, but the renderer-side fields stay identical so
`mobile-fit-overrides.ts` does not need to know about `seq`.

**Emission gating: mode-flip only.** Today, the runtime emits `terminalFitOverrideChanged` on
several paths that don't actually flip the renderer-visible mode (e.g. dim-only updates while
already in mobile-fit). After the rewrite, the event fires **only when the layout's `kind`
flips between `phone` and `desktop`** (`mobile-fit` ↔ `desktop-fit`). Dim-only changes (a
keyboard show/hide tweaking phone rows, a phone-owner switch keeping mobile-fit but with a
different viewport) do not fire the event. The renderer's mobile-fit-overrides hydration only
cares about the boolean "is this PTY currently in mobile-fit mode," and re-renders triggered
by every keyboard tap are wasteful churn. Mobile clients still receive a `resized` event on
every dim change because the mobile xterm needs to re-fit on dim changes too; the asymmetry is
deliberate.

`terminalDriverChanged` is unchanged. Driver state remains independent of layout state.

### Mobile → server (request schemas)

No changes. Existing `terminal.subscribe`, `terminal.send`, `terminal.setDisplayMode`,
`terminal.updateViewport`, `terminal.unsubscribe` shapes are preserved. The presence-lock
`client: { id, type }` field continues to do the same job.

### Mobile ← server (RPC response shape)

The RPC handlers that drive layout transitions (`terminal.setDisplayMode`,
`terminal.updateViewport`, the take-floor side of `terminal.send`) return a discriminated union
matching `ApplyLayoutResult`:

```ts
type TerminalLayoutRpcResponse =
  | { ok: true; seq: number }
  | { ok: false; reason: 'pty-exited' | 'resize-failed' }
```

This replaces today's "always return `{ ok: true, seq }` and pretend things worked" pattern,
which would lie when applyLayout rolled back or short-circuited because the PTY had exited.
Mobile-side RPC clients should treat the failure variants as follows:

- `'pty-exited'` is a terminal-gone signal: drop the local subscription, optionally show a
  toast ("session ended"), and stop sending RPCs against this `ptyId`. Retrying will not help.
- `'resize-failed'` is transient (SSH transport blip, node-pty hiccup): the runtime rolled
  back; no `resized` event was emitted; the caller can retry the same RPC after a short
  backoff.

The response shape is additive: older mobile clients that only check `ok` and read `seq`
unconditionally will treat a failure response as `{ ok: false, seq: undefined }` and most
existing code paths already handle that gracefully (the seq filter is fail-open).

`terminal.resizeForClient` returns this same `TerminalLayoutRpcResponse` discriminator. The
shim path described in the migration table computes a target, awaits `enqueueLayout`, and
returns the result verbatim. This is additive on the wire — older mobile builds that only
read `ok`/`seq` are unaffected by the new optional `reason` field, and older builds that
already retry on `ok: false` continue to work because `'resize-failed'` is retryable in their
model too (their existing retry path makes no claim about *why* the call failed).

## Mobile client changes

### Sequence-aware reinit guard

`mobile/app/h/[hostId]/session/[worktreeId].tsx` tracks the highest `seq` applied per terminal
handle in a ref:

```ts
const layoutSeqRef = useRef<Map<string, number>>(new Map())
```

In the subscribe callback:

```ts
if (data.type === 'scrollback' || data.type === 'resized') {
  const seq = typeof data.seq === 'number' ? data.seq : null
  if (seq != null) {
    const last = layoutSeqRef.current.get(handle) ?? 0
    // Fresh-subscription detection: a scrollback whose seq is far below
    // the stored seq means the server restarted the per-PTY counter (or
    // we missed an unsubscribe locally). Treat as a fresh subscription
    // and reset the gate. Threshold of 20 is generous — a real stale
    // event from an in-flight transition is at most a handful of seqs
    // behind the latest applied.
    if (data.type === 'scrollback' && last - seq > 20) {
      layoutSeqRef.current.delete(handle)
    } else if (seq <= last) {
      return  // stale — a newer transition has already applied
    }
    layoutSeqRef.current.set(handle, seq)
  }
  // existing init / write / fit logic
}
```

Lifecycle: the seq gate is **per-mounted-handle** and must be cleared on every event that
discards the xterm-side state, otherwise a fresh PTY's first `scrollback` (seq=1) gets dropped
because the ref still holds a much higher seq from a previous handle. Specifically:

1. **Unsubscribe.** The cleanup callback returned by `terminal.subscribe` does
   `layoutSeqRef.current.delete(handle)` after closing the stream.
2. **WebView reload.** `handleLoadStart` (and the iOS-foreground-resume re-entry, which fires
   after the WebView is paused while backgrounded) deletes the entry for every handle owned by
   this WebView. The xterm instance inside the WebView is gone; the JS ref outside is stale.
3. **Fresh-subscription detection (the >20 case above).** A defensive fallback for cases where
   1 and 2 didn't run (e.g. server-side state was lost but our cleanup didn't fire — server
   crash + reconnect). The first `scrollback` with seq much lower than the stored seq triggers
   a reset and the event is applied.

The fail-open behavior — `seq == null` ⇒ apply — is preserved across all three paths so older
servers that don't emit `seq` continue to work.

Stale events from in-flight transitions during rapid mode toggles or tab switches are dropped
without action. This kills the "init at desktop dims after subscribe-with-phone-viewport already
applied" race entirely, while the lifecycle reset paths kill the inverse "fresh subscribe is
ignored as stale" failure mode.

### Cold-load fit scale fix

`TerminalWebView.applyFitScale` today commits when `scrollWidth` is stable across two frames.
On a cold load, it can commit during a transient layout where xterm reports a positive but
partial `scrollWidth`, and the `>= 0.95` snap rounds the result to 1.0 — visible to the user as
"the terminal didn't zoom in."

After:

1. Compute the **expected** `scrollWidth` from the renderer's reported cell width and the
   current `term.cols`: `expected = cellWidth * cols`. If we have a renderer object with valid
   dimensions, the expected width is known exactly.
2. Wait until `scrollWidth === expected` (within 1 px tolerance) **or** the retry budget
   exhausts. The retry budget moves from 30 frames (~500 ms) to 60 frames (~1 s) since this is
   the cold-load case where Android Samsung devices have been observed to take 600 ms+.
3. Drop the `>= 0.95` snap entirely. Sub-pixel scale (e.g. 0.97) is correct when the terminal
   has a one-cell scrollbar gutter; snapping to 1.0 was a workaround for the broken commit
   timing, not a real correctness rule. After step 1 the partial-layout case is closed and
   `currentScale` is exact.

```js
function applyFitScale() {
  if (!term || !term.element) return
  const token = ++fitRetryToken
  let attempts = 0

  function attempt() {
    if (token !== fitRetryToken) return
    if (!term || !term.element) return

    var cellWidth = 0
    var core = term._core
    if (core && core._renderService && core._renderService.dimensions) {
      cellWidth = core._renderService.dimensions.css.cell.width
    }
    var w = term.element.scrollWidth
    var expected = cellWidth > 0 ? cellWidth * term.cols : 0

    attempts++
    if (cellWidth > 0 && w > 0 && Math.abs(w - expected) <= 1) {
      commitFitScale()
      return
    }
    if (attempts >= 60) {
      commitFitScale()
      return
    }
    requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}

function commitFitScale() {
  if (!term || !term.element) return
  currentScale = computeFitScale()  // unchanged: min(1, vpWidth / scrollWidth)
  // No more `>= 0.95` snap.
  userScale = 1
  panX = 0; panY = 0
  updateTransform()
}
```

### Re-fit on first live data chunk

Add a one-shot re-fit after the first `data` event following an `init`. Live PTY data can cause
xterm to relayout (font baseline shifts, cursor row changes), and the cold-load `applyFitScale`
may have committed before the canvas finished rendering. After:

```js
function write(data) {
  writeQueue.push(data)
  pumpWrites(terminalGeneration)
  if (firstDataPending) {
    firstDataPending = false
    afterWritesDrained(function () { applyFitScale() })
  }
}
```

`firstDataPending` is set to `true` inside `init` and `commitFitScale` does **not** clear it —
the reset live-data refit is independent of the eager init refit. Both fire; both are no-ops if
the scale is already correct.

### Removal of post-init `setTimeout(resetZoom, 200)` workarounds

`mobile/app/h/[hostId]/session/[worktreeId].tsx` has two `setTimeout(() => resetZoom(), 200)`
calls (after `scrollback` and after `resized`) that were workarounds for the cold-load race. Once
the WebView fix above lands, these are no-ops 99% of the time. Keep one 200 ms guard call after
`resized` only; the WebView's frame-retry handles the cold case directly.

## Server-side migration

Single PR, no feature flag. The change is internal — wire shapes are additive (`seq` is optional
on consumers).

### Files touched

1. `src/main/runtime/orca-runtime.ts`:
   - Add `private layouts = new Map<string, PtyLayoutState>()`.
   - Add `private layoutQueues = new Map<string, LayoutQueueEntry>()` (the per-PTY
     coalescing slot pair; see "enqueueLayout coalescing").
   - Add `private applyLayout(ptyId, target): Promise<ApplyLayoutResult>`,
     `private enqueueLayout(...)`, and `private runLayoutSlot(...)` (all private — only
     callable from this file).
   - **Every existing callsite that touches `terminalFitOverrides`, `ptySizes` (via
     `ptyController.resize`), or emits `terminalFitOverrideChanged` /
     `notifyFitOverrideListeners` / `notifyTerminalResize` is rewritten to compute a
     `PtyLayoutTarget` and `await this.enqueueLayout(...)` instead.** Concretely the rewritten
     callsites are:

     | Existing callsite (orca-runtime.ts) | Today's behavior | After |
     |---|---|---|
     | `handleMobileSubscribe` | Captures `previousCols/Rows`, sets `wasResizedToPhone`, calls `ptyController.resize`, sets `terminalFitOverrides`, emits `terminalFitOverrideChanged` + `notifyTerminalResize`. | Captures subscriber baseline, computes phone target, awaits enqueueLayout. |
     | `handleMobileUnsubscribe` | Removes subscriber, may schedule `pendingRestoreTimers`. | Removes subscriber, schedules debounce; debounce callback enqueues a `desktop` target. |
     | `applyMobileDisplayMode` | Branch on mode; mutates `wasResizedToPhone`, `terminalFitOverrides`, calls `ptyController.resize`, emits events. | Computes target from mode + most-recent-actor; awaits enqueueLayout. |
     | `mobileTookFloor` (lines ~1628–1655) | Re-applies phone-fit by calling `applyMobileDisplayMode`; updates `lastActedAt`. | Updates `lastActedAt`; if currently `desktop` or owner mismatch, awaits enqueueLayout with phone target. Driver flip stays separate. |
     | `updateMobileViewport` (lines ~1665–1735) | Mutates 5 maps. | Updates subscriber viewport; if layout is phone and this client is owner (or this client is most-recent-actor), awaits enqueueLayout with new viewport target. See pseudocode below. |
     | `reclaimTerminalForDesktop` | Resets `wasResizedToPhone`, calls `ptyController.resize`, deletes `terminalFitOverrides`, emits events. | Computes desktop target from `resolveDesktopRestoreTarget(ptyId)`; awaits enqueueLayout. |
     | `resizeForClient` (mobile RPC legacy path; lines ~1340–1410) | Sets `terminalFitOverrides` directly, calls `ptyController.resize`, emits events. The desktop-restore branch (lines ~1390–1400) calls `ptyController.resize` then sets the override flag. | Becomes a thin shim: compute target, enqueueLayout. The rollback-on-resize-failure logic moves into applyLayout. |
     | `onClientDisconnected` (lines ~1431–1545 across 4 sub-cases) | Directly mutates `terminalFitOverrides`, calls `ptyController.resize`, emits events for each disconnecting subscriber and each soft-leave promotion. | Becomes subscriber-map bookkeeping + driver flips only; every PTY-mutating sub-case routes through `enqueueLayout`. See "onClientDisconnected pseudocode" above. |
     | `pendingRestoreTimers` debounce callback (300 ms; lines ~2080–2100) | Calls `ptyController.resize`, deletes `terminalFitOverrides`, emits events. | Awaits enqueueLayout with `desktop` target. |
     | `pendingSoftLeavers` callback | Same as above. | Same as above. |
     | `onPtyExit` | Clears per-PTY maps. | Clears `layouts`, `layoutQueues`, plus the existing maps. Pending queued work checks `layouts.has(ptyId)` and short-circuits. |
     | `onExternalPtyResize` (lines ~2186–2200) | Mutates `lastRendererSizes` and overwrites every non-phone-fitted subscriber's `previousCols/Rows`. | Renamed conceptually to `onDesktopGeometryReported`. Updates `lastRendererSizes`. Refreshes subscriber `restoreBaselineCols/Rows` only on subscribers whose existing baseline is non-null (matching today's gate but using the renamed fields). Does **not** call applyLayout — it's a passive geometry report. |

     Removes `wasResizedToPhone`, `previousCols`, `previousRows` from the `Subscriber` record;
     replaces with `restoreBaselineCols`, `restoreBaselineRows` (rename + semantic preservation
     per the Restore baseline section).
   - `onClientDisconnected` and `onPtyExit` additionally clean up `layouts` and `layoutQueues`.
   - `pendingRestoreTimers` and `pendingSoftLeavers` are kept (debounce + grace are a separate
     concern from the state machine), but their fire callbacks now call `enqueueLayout` instead
     of mutating fields directly.

2. `src/main/runtime/rpc/methods/terminal.ts`:
   - `terminal.subscribe` emits `seq` on `scrollback` and `resized` events. Source: read
     `runtime.layouts.get(ptyId)?.seq` after `handleMobileSubscribe` returns (it bumps the seq).
   - No new schemas; no new methods.

3. `src/main/runtime/orca-runtime.test.ts`:
   - Existing transition-table tests pass unchanged (they assert observable behavior — emitted
     events, PTY size after transition — not internal flag state).
   - New tests:
     - `applyLayout` is idempotent for identical targets (no second resize, no second event).
     - `applyLayout` bumps `seq` exactly once per call.
     - Multi-mobile owner switch produces exactly one resize event with the new owner's
       viewport.
     - Take Back from `phone` to `desktop` produces exactly one resize event back to
       `restoreBaseline`.
     - Mode toggle phone→desktop→phone produces three resize events with monotonically
       increasing `seq`, regardless of `wasResizedToPhone`-equivalent internal state — the
       Bug 2 / Bug 5 / Bug 6 regressions from the investigation.

4. `mobile/app/h/[hostId]/session/[worktreeId].tsx`:
   - Add `layoutSeqRef` and the stale-event drop filter.
   - Drop the `setTimeout(() => resetZoom(), 200)` after `scrollback` (no longer needed; the
     WebView's own frame-retry handles cold-load). Keep the one after `resized` as a safety net.

5. `mobile/src/terminal/TerminalWebView.tsx`:
   - Replace `applyFitScale` per the spec above.
   - Remove the `>= 0.95` snap in `commitFitScale`.
   - Add the first-data-chunk re-fit hook in `write()`.
   - No public-API changes; existing callers see the same `init`/`write`/`clear`/`resetZoom`
     surface.

### Renderer cascade suppression

`resizeSuppressedUntil` is kept. The 500 ms global suppression after a desktop-fit transition
exists because the desktop renderer's collateral safeFit cascade (across all panes, not just the
affected one) can fire spurious `pty:resize` IPCs at the wrong dims. Under the new model:

- `applyLayout` calls `suppressResizesForMs(500)` whenever it transitions **out of** `phone` to
  `desktop` (the cascade trigger).
- `pty:resize` IPC handler still drops requests during the suppress window (unchanged).
- `onDesktopGeometryReported` ignores reports during the suppress window — they would
  otherwise repollute `restoreBaseline` with the cascade's transient bad value.

This is the only remaining "two writers can disagree" surface, and the suppression window is the
defense. After 500 ms the renderer's own measurement has converged on the correct pane geometry.

### Soft-leave grace

`pendingSoftLeavers` (250 ms) is kept. When the last mobile client unsubscribes, we don't want
the desktop banner to flash off-then-on if the same client immediately resubscribes (e.g.
keyboard show/hide on older mobile builds that don't use `terminal.updateViewport`). The grace
holds `currentDriver` at `mobile{clientId}` for 250 ms.

The grace does **not** touch the layout state. The layout transitions to `desktop` only after
the 300 ms restore debounce fires AND the inner subscriber map is empty. Driver and layout are
decoupled.

## Edge cases

- **Mobile drops network mid-transition.** WS doesn't immediately know. The seq the mobile last
  saw is preserved in its `layoutSeqRef`. On reconnect, `terminal.subscribe` emits a fresh
  `scrollback` event with a higher seq — mobile applies it, updating the ref. No special
  reconnect logic needed.
- **Two phones, different viewports, rapid take-floor ping-pong.** Each `mobileTookFloor`
  computes a new target with the current actor's viewport and calls `enqueueLayout`. Because
  consecutive take-floor targets carry different `ownerClientId`s, none of them coalesce —
  each one is appended as its own slot in the pending FIFO. Every appended slot runs in
  order, each transition bumps seq, each emits its own `resized` event. Both phones see all
  transitions in order; their seq filter only drops events older than what they've already
  applied. (Coalescing only collapses same-owner viewport ticks, so a Take Floor button can
  never be silently dropped by a competing phone's viewport update.)
- **Take Back during the 300 ms restore debounce.** The debounced callback checks
  `isMobileSubscriberActive(ptyId)` — if the desktop user took back manually (driver flipped to
  `desktop`, banner unmounted, layout target = `desktop`) the debounce no-ops. If the debounce
  fires first, `applyLayout` is called with `desktop` target; the manual Take Back arrives next
  and computes the same target → idempotent no-op.
- **PTY exits during a transition.** `onPtyExit` clears `layouts` and `restoreBaseline`. Any
  pending debounce callbacks check `layouts.has(ptyId)` and bail early.
- **Renderer cascade reports a wrong size during the suppress window.** `pty:resize` IPC is
  dropped at the entry point. `onDesktopGeometryReported` checks `isResizeSuppressed()` and
  bails. The suppress window fully isolates the cascade.
- **Renderer geometry report while layout is `phone`.** `onDesktopGeometryReported` records the
  size but does not call `applyLayout` — the desktop panel is invisible to mobile while phone is
  active, and `restoreBaseline` is already captured. The recorded size is used the **next** time
  a transition to `desktop` runs, so the restore lands at the renderer's current pane geometry,
  not the pre-mobile snapshot. (Pre-mobile capture is the fallback when no renderer report has
  arrived yet.)
- **iOS WebView background→foreground pause/resume.** When the OS pauses the WebView, in-flight
  layout transitions queue on the main thread; on resume the WebView replays them. The seq
  filter would drop everything older than the highest seq it had applied before pausing, but
  that's wrong if the foreground re-mount actually started a fresh xterm instance. The
  WebView-reload reset path in the seq lifecycle (point 2 above) covers this: foreground resume
  triggers `handleLoadStart`-equivalent which clears the per-handle seq, and the next
  `scrollback` is applied even though its seq is lower than the pre-pause high-water mark.
- **Network drop with reconnect inside the soft-leave grace.** A phone briefly drops WS for less
  than 250 ms (the soft-leave grace) and reconnects. Today, the runtime issues two PTY
  resizes — one when the soft-leave fires (no, soft-leave doesn't fire because grace holds
  things stable) and one on resubscribe with a fresh viewport. Under the new model the same
  thing happens: the disconnect path clears the subscriber after grace expires (or the
  reconnect aborts the grace), and a fresh subscribe enqueues a phone-target applyLayout.
  Either way, exactly one or two PTY resizes per blip — same as today. Acceptable.

## Compatibility

- **Older mobile builds** (no seq filter): they apply every `scrollback`/`resized` event in
  order, exactly as today. The seq field is ignored. They get all the bug fixes from the
  server-side state-machine consolidation but lose the stale-event drop. Acceptable —
  pre-state-machine is what they have today, and the state machine itself fixes the bulk of the
  observable bugs.
- **Older mobile builds** (no `terminal.updateViewport`): they unsubscribe → resubscribe on
  keyboard show/hide. The 250 ms soft-leave grace covers the gap; the new subscribe runs
  through `applyLayout` and produces a clean transition. Same as today.
- **Renderer**: the existing `mobile-fit-overrides.ts` hydration and listener API is unchanged.
  The renderer never sees `seq`.
- **CLI / desktop runtime callers** of `runtime.resizeForClient`: these are the legacy mobile
  RPC paths that still flow through `resizeForClient`. After the rewrite, `resizeForClient`
  becomes a thin shim that computes a target and calls `applyLayout`. Behavior is unchanged for
  all observable inputs; the layout state machine just owns the writes now.

## Test plan

- **Unit tests** in `orca-runtime.test.ts`:
  - One per transition row in the inputs table above. Each asserts (prev layout, trigger) →
    (new layout, exactly one PTY resize call, exactly one resize wire event with monotonic seq).
  - Idempotency: calling `applyLayout` with the current state target is a no-op (no resize, no
    event, no seq bump).
  - Multi-mobile: A subscribes (auto), B subscribes (auto, different viewport), B takes floor,
    A takes floor. Three seq bumps; the last layout is `phone(A.viewport, A)`.
  - PTY exit during pending-restore debounce.
  - Renderer cascade during suppress window does not pollute `restoreBaseline`.
- **Test stubs for rollback path.** Add a `failsOnNthCall` ptyController fake at
  `tests/fakes/pty-controller.ts` (or wherever runtime test fakes live in this repo). It
  tracks call count and is configurable to return `false` or throw on the Nth call. A new
  test file `applyLayout-rollback.test.ts` uses it to force a rollback and asserts:
  (a) `layouts` reverts to its pre-call snapshot,
  (b) `terminalFitOverrides` reverts to its pre-call snapshot,
  (c) no `resized` event is emitted on the mobile subscribe stream,
  (d) no `terminalFitOverrideChanged` is emitted to the renderer,
  (e) the RPC handler returns `{ ok: false, reason: 'resize-failed' }`,
  (f) the next successful applyLayout starts at pre-failure `seq + 1` (the failed attempt
  did not bump the wire seq).
- **Integration test** `mobile-subscribe-integration.test.ts`:
  - Phone subscribes, takes floor, gets `phone` dims; toggles to desktop, gets `desktop` dims;
    toggles back to auto, gets `phone` dims again. All three transitions produce a `resized`
    event with strictly increasing seq.
  - Stale event drop: simulate a delayed `resized` from an older seq arriving after a newer
    one has been applied; assert mobile-side handler does not reinit xterm.
- **Renderer test** `fit-override-integration.test.ts`:
  - Existing safeFit-suppression tests pass unchanged (the wire shape is the same).
- **Mobile unit test** in `mobile/`:
  - `TerminalWebView.applyFitScale` correctly handles a zero-scrollWidth first frame and only
    commits once `cellWidth * cols` matches `scrollWidth`. Mock `requestAnimationFrame`.
  - First-data-chunk re-fit: after `init` then `write`, exactly two `applyFitScale` invocations
    occur (one inside init's after-drain callback, one in the write hook). After write a
    second time, no further `applyFitScale`.

## Out of scope

- Mobile-side "Desktop is driving" banner.
- Unifying desktop and mobile write paths into a single coordinator (forward path, see
  `docs/mobile-presence-lock.md`).
- Reworking the worktree-tab focus model to avoid the "active terminal mismatch" bug.
- **Two-phone rapid take-floor byte-stream interleaving.** When two phones rapidly hand off the
  floor, byte-stream events from the previous owner can arrive at the renderer interleaved
  with the new owner's bytes. This is an orthogonal coordinator-level concern (about
  serializing input streams, not about layout), not a layout-state-machine concern. The state
  machine guarantees layout convergence; byte-stream interleaving is filed against the
  presence-lock forward-path work.

## Rollout

Single PR. Server changes (state machine consolidation), wire-format addition (`seq`), and
mobile/renderer changes ship together. We considered splitting the wire-format change from the
runtime refactor for tighter bisect, but rejected that: the wire change is meaningless without
the runtime emitting `seq` from the new state machine, and the runtime's correctness guarantees
depend on the mobile side honoring `seq`. Pairing them in one PR keeps the test surface
coherent.

The bisect strategy under one PR relies on the wire change being **strictly additive on both
sides**:

- The `seq` field is optional in the streamed event payloads. Older mobile builds ignore it;
  they apply every event, exactly as today, and lose the stale-event drop.
- The mobile-side seq filter is **fail-open**: if `data.seq` is missing or null, the event is
  applied. A partial mobile revert (back to a build that doesn't emit seq) running against a
  new server still works.
- Equivalently, a partial server-only revert (back to a build that doesn't bump seq) running
  against a new mobile build still works — the mobile side sees seq missing on every event and
  applies them all.

So a regression that is local to either side can be reverted on that side alone without
breaking the other. If the state machine consolidation itself regresses something subtle, a
single-commit revert restores prior behavior on both sides simultaneously.

## Appendix A: Investigation Evidence

This appendix anchors the design's motivation in concrete code locations. The four user-visible
symptoms that triggered this work each map to a specific buggy interaction between the
overlapping pieces of state described in the Problem section. For each symptom: where the bug
lives in `src/main/runtime/orca-runtime.ts` (current `main` at the time of writing), and a
numbered repro that triggers it.

> **Note on line numbers.** These references are for ground-truth audit only. They are not
> automatically maintained; ordinary refactors will drift them. When reading after a few weeks,
> cross-reference by symbol name (`applyMobileDisplayMode`, `resizeForClient`, `mobileTookFloor`,
> `onExternalPtyResize`) rather than by raw line number.

### Symptom 1: "Claim worked but the mobile terminal is still zoomed out"

**Location.** `applyMobileDisplayMode`, the `mode === 'auto'` (non-desktop) branch — the
`!subscriberRecord.wasResizedToPhone` early-return check at orca-runtime.ts ~lines 2167–2175.
When `wasResizedToPhone` is `true` but the PTY has actually drifted back to desktop dims (e.g.
because a renderer cascade or take-back ran without clearing the flag on every subscriber), the
branch skips the resize, leaving the mobile xterm at desktop dims.

**Repro.**
1. Phone subscribes with `mode='auto'`, viewport e.g. 80×24. PTY resizes to phone dims;
   `wasResizedToPhone = true`.
2. Desktop user clicks "Take Back". `applyMobileDisplayMode` with `mode='desktop'` clears
   `wasResizedToPhone` on the **subscriber-record** path but the test fixture happens to
   trigger an `onExternalPtyResize` mid-cascade that restores the flag (see Symptom 4 below).
3. Phone toggles mode back to `auto`. The early-return fires; no resize is issued.
4. Mobile xterm stays at desktop dims; user perceives "claim didn't work."

### Symptom 2: "Release didn't restore the desktop"

**Location.** `resizeForClient` desktop-restore path at orca-runtime.ts ~lines 1390–1400. The
restore branch reads `previousCols/Rows` off the override, calls `ptyController.resize`, then
deletes the override. But if `previousCols/Rows` are `null` (e.g. the override was created by a
non-resize-capturing path, or a peer subscriber stored its baseline as `null` during a join
into an already-fitted PTY), the resize is skipped and the PTY stays at phone dims while the
override is deleted — visible as "release didn't restore."

**Repro.**
1. Phone A subscribes with `mode='auto'`. Captures `previousCols/Rows` = (200, 50). PTY at
   80×24 (phone dims).
2. Phone B subscribes (also `mode='auto'`). It joins the already-fitted PTY; per today's
   per-subscriber capture logic, B's `previousCols/Rows` are captured as the *current* phone
   dims (80×24) — the existing override blocks pristine capture.
3. Phone A leaves. The remaining `terminalFitOverrides[ptyId].clientId` flips to B. The override
   keeps A's previousCols/Rows.
4. Phone B sets `mode='desktop'`. `resizeForClient`'s restore branch reads the override's
   `previousCols/Rows` — but the test setup or a race has nulled them through one of the
   `wasResizedToPhone`-clearing paths. Resize is skipped. PTY stays at 80×24.
5. Renderer banner unmounts (driver = desktop), but the desktop pane is still showing 80×24
   content with broken line wrapping.

### Symptom 3: "Pressing the resize button twice fixes it"

**Location.** Same as Symptom 1 — the `wasResizedToPhone` early-return at ~lines 2167–2175.
First toggle hits the early-return because the flag is still `true`. The toggle's mode update
(`setDisplayMode` flipping the mode in `mobileDisplayModes`) lands, but no resize fires. Second
toggle: `wasResizedToPhone` was cleared by some adjacent path between the two clicks (or by the
mode change itself, depending on the path), so the second toggle's `applyMobileDisplayMode`
takes the actual-resize branch.

**Repro.** Same as Symptom 1, plus:
6. Phone toggles mode again. Second time through the same code, the flag has been cleared (the
   `applyMobileDisplayMode` desktop branch on the previous click cleared
   `anyWasResized = true; sub.wasResizedToPhone = false`); now the auto/phone branch's
   subscriber check passes, `handleMobileSubscribe` fires, PTY resizes correctly.

### Symptom 4: "Switching tabs back and forth on the phone fixes it"

**Location.** `onExternalPtyResize` at orca-runtime.ts ~lines 2186–2200. This handler runs when
the desktop renderer's safeFit cascade emits a `pty:resize` IPC mid-mobile-fit. Today it
unconditionally walks every subscriber and overwrites their `previousCols/Rows` if their
`wasResizedToPhone` is `false` — but during a cascade-mid-restore window, the flag is in
transition: some subscribers have been cleared, others haven't. The result is that the
just-cleared subscriber's pristine baseline (which we needed for the restore) gets overwritten
with a transient renderer-cascade size (often a wrong intermediate value like 214 cols mid-
animation). The next restore lands on the wrong dims; tab-switch on the phone forces a
`terminal.unsubscribe` → resubscribe, which rebuilds the entire subscriber record from scratch
and "fixes" the desync by happening to re-read the now-converged renderer size.

**Repro.**
1. Phone subscribes. Baseline captured = (200, 50). PTY fits to 80×24.
2. Desktop user resizes the Electron window. The renderer's safeFit cascade emits two or three
   `pty:resize` IPCs in rapid succession (the cascade fires for each pane and re-fires after
   React re-renders).
3. `onExternalPtyResize` runs once per IPC. Each run walks subscribers and overwrites
   `previousCols/Rows` for any subscriber whose `wasResizedToPhone` is `false`. (The fixture
   path that triggers this regression is when one of the prior IPCs has already cleared the
   flag for some subscribers but not others.) The pristine 200×50 baseline is overwritten
   with the cascade's transient 214×42.
4. Phone sets `mode='desktop'`. Restore target = (214, 42). PTY ends up at 214×42 instead of
   200×50; desktop pane content wraps wrong.
5. Phone unsubscribes by switching tabs and resubscribes. The fresh subscribe captures the
   *current* (now-converged) renderer size as its baseline, which happens to be 200×50, and
   subsequent restores work — the desync is "papered over" by re-reading state from scratch.

### Symptom cross-reference

The four symptoms collectively prove the structural problem: each piece of state
(`wasResizedToPhone`, `previousCols/Rows`, `terminalFitOverrides`, `mobileDisplayModes`, the
actual PTY size) is mutated by a different subset of callsites, and no single function takes
responsibility for keeping them consistent. The state machine introduced in this design closes
all four by routing every transition through `applyLayout`, which is the only writer of the
maps and the only emitter of the wire events.
