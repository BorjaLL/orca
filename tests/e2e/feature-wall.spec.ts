import { test, expect } from './helpers/orca-app'
import { getStoreState, waitForSessionReady } from './helpers/store'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'

async function openFeatureTourFromMenu(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const featureTourItem = Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'Help')
      ?.submenu?.items.find((item) => item.label === 'Feature tour')

    if (!featureTourItem) {
      throw new Error('Feature tour menu item was not registered')
    }

    const window = BrowserWindow.getAllWindows()[0]
    featureTourItem.click(featureTourItem, window, {
      triggeredByAccelerator: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    } as Electron.KeyboardEvent)
  })
}

async function loadedSelectedPreviewImage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const figure = document.querySelector('section figure img')
    return figure instanceof HTMLImageElement && figure.complete && figure.naturalWidth > 0
  })
}

test.describe('Feature tour modal', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  test('opens from the Help menu, renders the workflow rail, and routes the primary CTA', async ({
    electronApp,
    orcaPage
  }) => {
    await openFeatureTourFromMenu(electronApp)

    await expect(orcaPage.getByRole('dialog', { name: 'Get to know Orca' })).toBeVisible({
      timeout: 10_000
    })
    await expect(orcaPage.getByText('Reopen any time from Help > Feature tour.')).toBeVisible()

    // Five workflow rows in the rail.
    const rail = orcaPage.getByRole('navigation', { name: 'Workflows' })
    await expect(rail.getByRole('tab')).toHaveCount(5)
    await expect(rail.getByRole('tab', { name: /Start work/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    // Default-selected workflow's primary tile poster loads.
    await expect
      .poll(async () => loadedSelectedPreviewImage(orcaPage), {
        timeout: 10_000,
        message: 'feature-wall preview media did not load for the default workflow'
      })
      .toBe(true)

    // ArrowDown moves selection through the rail.
    await rail.getByRole('tab', { name: /Start work/i }).focus()
    await orcaPage.keyboard.press('ArrowDown')
    await expect(rail.getByRole('tab', { name: /Coordinate agents/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    // Primary CTA for "Coordinate agents" closes the modal and opens agent settings.
    await orcaPage.getByRole('button', { name: /Open agent settings/i }).click()
    await expect(orcaPage.getByRole('dialog', { name: 'Get to know Orca' })).toHaveCount(0)
    await expect.poll(async () => getStoreState<string>(orcaPage, 'activeModal')).toBe('none')
    await expect.poll(async () => getStoreState<string>(orcaPage, 'activeView')).toBe('settings')
    await expect(
      orcaPage.locator('[data-settings-section="agents"]').getByRole('heading', {
        name: 'Agents'
      })
    ).toBeVisible()
  })

  test('docs link in the footer opens the workflow docs URL', async ({ electronApp, orcaPage }) => {
    await openFeatureTourFromMenu(electronApp)
    await expect(orcaPage.getByRole('dialog', { name: 'Get to know Orca' })).toBeVisible({
      timeout: 10_000
    })

    await electronApp.evaluate(({ shell }) => {
      const testGlobal = globalThis as typeof globalThis & {
        __featureWallOpenedDocsUrl: string | null
        __featureWallOriginalOpenExternal?: typeof shell.openExternal
      }
      testGlobal.__featureWallOpenedDocsUrl = null
      testGlobal.__featureWallOriginalOpenExternal = shell.openExternal
      shell.openExternal = ((url: string) => {
        testGlobal.__featureWallOpenedDocsUrl = url
        return Promise.resolve()
      }) as typeof shell.openExternal
    })
    try {
      await orcaPage.getByRole('button', { name: /Open docs/i }).click()
      await expect
        .poll(() =>
          electronApp.evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  __featureWallOpenedDocsUrl: string | null
                }
              ).__featureWallOpenedDocsUrl
          )
        )
        .toBe('https://www.onorca.dev/docs/review/linear')
    } finally {
      await electronApp.evaluate(({ shell }) => {
        const originalOpenExternal = (
          globalThis as typeof globalThis & {
            __featureWallOriginalOpenExternal?: typeof shell.openExternal
          }
        ).__featureWallOriginalOpenExternal
        if (originalOpenExternal) {
          shell.openExternal = originalOpenExternal
        }
      })
    }
  })

  test('shows the bottom-right nudge and opens the full tour', async ({ orcaPage }) => {
    await orcaPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().closeModal()
      store.getState().showFeatureTourNudge()
    })

    const nudge = orcaPage.getByRole('complementary', {
      name: 'Take the Orca feature tour'
    })
    await expect(nudge).toBeVisible()
    await expect(nudge.getByText('See what Orca can do')).toBeVisible()
    await expect(
      nudge.getByText('A quick walkthrough of the workflows built into Orca.')
    ).toBeVisible()
    await expect(nudge.getByText('Reopen any time from Help > Feature tour.')).toBeVisible()
    await expect(nudge.locator('[data-feature-tour-nudge-visual]')).toBeVisible()
    await expect
      .poll(
        () =>
          nudge
            .locator('[data-feature-tour-nudge-caption]')
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
        {
          message: 'feature tour nudge caption should not be clipped'
        }
      )
      .toBe(true)
    await expect(nudge.locator('img')).toHaveCount(0)

    const takeTourButton = nudge.getByRole('button', { name: /^Take the tour$/ })
    await expect(takeTourButton).toBeVisible()
    await takeTourButton.click()
    await expect(orcaPage.getByRole('dialog', { name: 'Get to know Orca' })).toBeVisible()
    await expect
      .poll(async () => getStoreState<boolean>(orcaPage, 'featureTourNudgeVisible'))
      .toBe(false)
  })
})
