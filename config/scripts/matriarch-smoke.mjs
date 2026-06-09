// Headless UI smoke test for the Matriarch Portal built bundle.
// Serves out/matriarch over HTTP, drives a real browser (Playwright) through all
// six v1 surfaces in #mock mode, and asserts the run_7a3 fixtures render. Exits
// non-zero on any failed assertion so it can gate a release.
//
// Usage: node config/scripts/matriarch-smoke.mjs
// Requires: a built bundle (pnpm build:matriarch) + a usable Chromium/Chrome.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('../../out/matriarch', import.meta.url))
const PORT = 4798

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0].split('#')[0]
      const rel = url === '/' ? '/matriarch-index.html' : url
      const path = normalize(join(ROOT, rel))
      if (!path.startsWith(ROOT) || !existsSync(path)) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const body = await readFile(path)
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' })
      res.end(body)
    } catch (error) {
      res.writeHead(500)
      res.end(String(error))
    }
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

let passed = 0
let failed = 0
function assert(label, condition) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.error(`  ✗ ${label}`)
  }
}

async function main() {
  if (!existsSync(join(ROOT, 'matriarch-index.html'))) {
    console.error('No build found at out/matriarch — run `pnpm build:matriarch` first.')
    process.exit(2)
  }
  const server = await serve()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push(m.text())
    }
  })

  try {
    const base = `http://127.0.0.1:${PORT}/matriarch-index.html`
    await page.goto(`${base}#mock`, { waitUntil: 'networkidle' })

    // ── Shell (Board is the default surface now) ──────────────────────────
    await page.waitForSelector('text=Matriarch', { timeout: 10_000 })
    assert('shell wordmark renders', await page.locator('text=Matriarch').count() > 0)
    assert('nav has Agents/Board/Inbox', (await page.locator('button:has-text("Board")').count()) > 0)
    assert('backend chip shows mock run', (await page.getByText(/run_7a3/).count()) > 0)
    assert('Board renders as the default surface', (await page.getByText(/· poll/).count()) > 0)

    // ── Agents ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Agents' }).click()
    await page.waitForTimeout(150)
    assert('Live freshness shown on Agents', (await page.getByText(/Live ·/).count()) > 0)
    assert('coordinator card present', (await page.getByText('Run coordinator').count()) > 0)
    assert(
      'agent labelled by its task title',
      (await page.getByText('Workspace-ports status line').count()) > 0
    )
    // The rail is a shell-level sidebar toggled from the header badge (default closed).
    await page.getByTitle('Show needs attention').click()
    await page.waitForTimeout(150)
    assert('needs-attention rail opens from the badge', (await page.getByText('Needs attention').count()) > 0)
    assert(
      'rail surfaces the pending gate',
      (await page.getByText(/Decision gate/).count()) > 0
    )
    // Clicking an escalation (handle-only, no taskId) opens the full-body detail —
    // it must never no-op even if the source agent has decayed out of the feed.
    await page.getByText('Escalation', { exact: true }).first().click()
    await page.waitForTimeout(200)
    assert(
      'escalation opens a detail with the full body',
      (await page.getByText(/circuit-broke at 3\/3/).count()) > 0
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    // The same badge toggles the rail closed again (the reported missing affordance).
    await page.getByTitle('Hide needs attention').click()
    await page.waitForTimeout(150)
    assert('badge toggles the rail closed', (await page.getByText('Needs attention').count()) === 0)

    // filter to Waiting → only the waiting agent (term_3b) remains
    await page.getByRole('button', { name: 'Waiting' }).click()
    await page.waitForTimeout(150)
    assert(
      'Waiting filter narrows the fleet',
      (await page.getByText('Repo-badge color cache').count()) > 0 &&
        (await page.getByText('GitLab resolveDiscussion parity').count()) === 0
    )
    await page.getByRole('button', { name: 'All', exact: true }).click()

    // ── Board (terminal-first: one card per terminal, agent/task folded in) ──
    await page.getByRole('button', { name: 'Board' }).click()
    await page.waitForSelector('text=Board', { timeout: 5000 })
    for (const col of ['Todo', 'Working', 'Needs you', 'Review & ship', 'Done', 'Parked']) {
      assert(`board column "${col}"`, (await page.getByText(col, { exact: true }).count()) > 0)
    }
    assert('board freshness reads poll, not live', (await page.getByText(/· poll/).count()) > 0)
    assert(
      'a terminal card leads with its worktree identity',
      (await page.getByText('workspace-ports', { exact: true }).count()) > 0
    )
    assert(
      'the per-terminal note renders on the card',
      (await page.getByText('adding the ports field to orca status --json').count()) > 0
    )
    assert('a queued task appears in Todo', (await page.getByText('Doc: web client pairing flow').count()) > 0)
    assert('a plain shell renders in Parked', (await page.getByText('homelab', { exact: true }).count()) > 0)
    assert('shell shows its worktree', (await page.getByText('scrum-team-1', { exact: true }).count()) > 0)
    assert('DAG view affordance', (await page.getByRole('button', { name: /DAG view/ }).count()) > 0)
    assert(
      'branch chip pairs worktree + branch (scrum-team-1/main)',
      (await page.getByText('scrum-team-1/main').count()) > 0
    )
    assert(
      'an orphaned dispatch surfaces in Needs you (not Working)',
      (await page.getByText('Visually verify the board columns').count()) > 0
    )

    // open the orphaned dispatch → task detail offers "Hand to matriarch"
    await page.getByText('Visually verify the board columns').first().click()
    await page.waitForTimeout(250)
    assert(
      'orphaned task detail offers Hand to matriarch',
      (await page.getByRole('button', { name: /Hand to matriarch/ }).count()) > 0
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // open a terminal card → terminal detail Sheet (note + Open in Orca + task link)
    await page.getByText('adding the ports field to orca status --json').first().click()
    await page.waitForTimeout(250)
    assert('terminal detail Sheet shows the Note section', (await page.getByText('Note', { exact: true }).count()) > 0)
    assert(
      'terminal detail offers Open in Orca',
      (await page.getByRole('button', { name: /Open in Orca/ }).count()) > 0
    )
    assert(
      'terminal detail cross-links to the task',
      (await page.getByRole('button', { name: /View task/ }).count()) > 0
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // the card's branch chip opens that agent (read-only terminal↔agent link)
    await page.locator('button[title="workspace-ports/BorjaLL/workspace-ports"]').first().click()
    await page.waitForTimeout(250)
    assert(
      'branch chip opens the agent detail',
      (await page.getByText('Active tool').count()) > 0
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // ── Inbox ─────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.waitForSelector('text=Audit trail', { timeout: 5000 })
    assert('inbox audit header', (await page.getByText(/Audit trail/).count()) > 0)
    assert(
      'escalation message rendered',
      (await page.getByText(/circuit-broke at 3\/3/).count()) > 0
    )
    assert('decision_gate type badge', (await page.getByText('decision_gate').count()) > 0)
    // filter by type → escalation only
    await page.getByText('escalation', { exact: true }).first().click()
    await page.waitForTimeout(150)
    assert(
      'type filter narrows the log',
      (await page.getByText(/PR #3734 approved/).count()) === 0
    )

    // ── Dark mode (default on; toggle flips it) ────────────────────────────
    assert('dark mode is the default', await page.evaluate(() => document.documentElement.classList.contains('dark')))
    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await page.waitForTimeout(150)
    assert('toggling theme turns dark off', await page.evaluate(() => !document.documentElement.classList.contains('dark')))

    assert('no uncaught page errors', errors.length === 0)
    if (errors.length) {
      console.error(`  page errors:\n   ${errors.join('\n   ')}`)
    }
  } finally {
    await browser.close()
    server.close()
  }

  console.log(`\nMatriarch smoke: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('smoke crashed:', error)
  process.exit(1)
})
