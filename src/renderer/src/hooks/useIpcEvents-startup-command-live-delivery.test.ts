import { describe, expect, it, type Mock } from 'vitest'
import { PASTE_TERMINAL_TEXT_EVENT, type PasteTerminalTextDetail } from '@/constants/terminal'
import { createHarnessStoreState, loadIpcEventsHarness } from './ipc-events-test-harness'

// Regression for orca-tracker-qwb: a `terminal.create --command` targeting a
// ptyId already owned by an existing tab reuses that tab instead of minting a
// new one (activateExistingLeafInLayout). That tab's TerminalPane is already
// mounted, so the pendingStartupByTabId queue TerminalPane reads at mount
// (a one-shot useState) has already resolved to undefined and will never be
// re-read: the command strands. This asserts the caller-side half of the fix
// -- a live-pane paste event dispatched only on the reuse path -- without
// needing a running renderer/PaneManager to prove the strand no longer
// happens.
describe('useIpcEvents startup command delivery for a reused/already-mounted tab', () => {
  function pasteEventDetails(): PasteTerminalTextDetail[] {
    return (window.dispatchEvent as Mock).mock.calls
      .map((call) => call[0] as CustomEvent<PasteTerminalTextDetail>)
      .filter((event) => event.type === PASTE_TERMINAL_TEXT_EVENT)
      .map((event) => event.detail)
  }

  it('dispatches a live-pane paste-and-run event when the target tab already owns the ptyId', async () => {
    const storeState = createHarnessStoreState({
      tabsByWorktree: { 'wt-1': [{ id: 'tab-existing', ptyId: 'pty-existing' }] },
      ptyIdsByTabId: { 'tab-existing': ['pty-existing'] }
    })
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    harness.createTerminal({
      worktreeId: 'wt-1',
      ptyId: 'pty-existing',
      leafId: 'leaf-existing',
      command: 'echo hi',
      tabId: 'tab-existing'
    })

    // The mount-only queue still gets the write (harmless: nothing will ever
    // read it back for an already-mounted tab), but delivery must not depend
    // on it alone.
    expect(storeState.queueTabStartupCommand).toHaveBeenCalledWith(
      'tab-existing',
      expect.objectContaining({ command: 'echo hi' })
    )
    expect(pasteEventDetails()).toContainEqual({
      tabId: 'tab-existing',
      leafId: 'leaf-existing',
      text: 'echo hi',
      runAfterPaste: true,
      expectedPtyId: 'pty-existing'
    })
  })

  it('does not dispatch the live-pane event for a brand-new tab (no race: nothing is mounted yet)', async () => {
    const storeState = createHarnessStoreState({ tabsByWorktree: {} })
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    harness.createTerminal({
      worktreeId: 'wt-1',
      ptyId: 'pty-new',
      leafId: 'leaf-new',
      command: 'echo hi',
      tabId: 'tab-new'
    })

    expect(storeState.queueTabStartupCommand).toHaveBeenCalled()
    expect(pasteEventDetails()).toHaveLength(0)
  })

  it('does not dispatch the live-pane event when the reused tab has no command to deliver', async () => {
    const storeState = createHarnessStoreState({
      tabsByWorktree: { 'wt-1': [{ id: 'tab-existing', ptyId: 'pty-existing' }] },
      ptyIdsByTabId: { 'tab-existing': ['pty-existing'] }
    })
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    harness.createTerminal({
      worktreeId: 'wt-1',
      ptyId: 'pty-existing',
      leafId: 'leaf-existing',
      tabId: 'tab-existing'
    })

    expect(storeState.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(pasteEventDetails()).toHaveLength(0)
  })
})
