// Why: a renderer-backed `terminal.create` commits its tab before main can prove
// it, and under load that proof (graph sync delivering the leaf) outruns the
// create's wait. Rejecting there told every CLI client "no tab", and they
// re-created: duplicate workers on one tree (orca-tracker-er7). The create now
// answers with a handle parked on the one identity the renderer has proven, the
// tabId; the runtime binds it to the tab's PTY as soon as that PTY registers or
// graph sync delivers the leaf, so the caller keeps one identity throughout.

// Why: a tab that never materializes must not pin its handle forever; evicting
// the oldest costs that caller a stale-handle error, which is what it got
// before parking existed.
export const PARKED_TERMINAL_CREATE_HANDLE_CAP = 32

export const TERMINAL_HANDLE_PENDING_CODE = 'terminal_handle_pending'

export class TerminalHandlePendingError extends Error {
  readonly code = TERMINAL_HANDLE_PENDING_CODE
  readonly data: { tabId: string; nextSteps: string[] }

  constructor(handle: string, tabId: string) {
    super(
      `Terminal handle ${handle} is not bound yet: tab ${tabId} exists but its terminal has not registered.`
    )
    this.name = 'TerminalHandlePendingError'
    this.data = {
      tabId,
      nextSteps: [
        'Wait a few seconds and retry with the same handle; do not create another terminal.',
        `Run \`orca terminal list --json\` and look for tabId ${tabId} to see when it registers.`
      ]
    }
  }
}

export class RendererTerminalCreatePendingHandles {
  private readonly handleByTabId = new Map<string, string>()
  private readonly tabIdByHandle = new Map<string, string>()

  park(tabId: string, handle: string): void {
    this.release(tabId)
    this.handleByTabId.set(tabId, handle)
    this.tabIdByHandle.set(handle, tabId)
    while (this.handleByTabId.size > PARKED_TERMINAL_CREATE_HANDLE_CAP) {
      const oldestTabId = this.handleByTabId.keys().next().value
      if (oldestTabId === undefined) {
        break
      }
      this.release(oldestTabId)
    }
  }

  /** Unparks and returns the handle waiting on this tab, if any. */
  take(tabId: string): string | null {
    const handle = this.handleByTabId.get(tabId) ?? null
    if (handle !== null) {
      this.release(tabId)
    }
    return handle
  }

  tabIdFor(handle: string): string | null {
    return this.tabIdByHandle.get(handle) ?? null
  }

  get size(): number {
    return this.handleByTabId.size
  }

  private release(tabId: string): void {
    const handle = this.handleByTabId.get(tabId)
    if (handle === undefined) {
      return
    }
    this.handleByTabId.delete(tabId)
    this.tabIdByHandle.delete(handle)
  }
}
