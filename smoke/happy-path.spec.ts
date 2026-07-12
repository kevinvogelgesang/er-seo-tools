import { test, expect } from '@playwright/test'
import path from 'node:path'

// A7 PR3 Task 3.3 — end-to-end happy-path smoke.
//
// Exercises three legs against the built (production-mode) app + the
// loopback fixture server started by playwright.config.ts's webServer array:
//   1. LOGIN     — break-glass password sign-in.
//   2. UPLOAD    — Screaming Frog CSV upload → parse → SEO results render.
//   3. SINGLE-PAGE AUDIT — ADA audit against the loopback fixture, polled to
//      completion (permitted only in SMOKE_MODE via the loopback SSRF
//      allowlist landed in Task 3.1).
//
// All assertions are on stable, user-visible text — never internal DOM
// structure — per the harness rule that a smoke must actually prove the
// three legs, not just render *something*.

const FIXTURE_DIR = path.resolve(__dirname, '..', 'test-fixtures', 'smoke')

test.describe.configure({ mode: 'serial' })

test('login, then SF upload/parse/report, then single-page audit to completion', async ({ page }) => {
  // Three real legs (login, upload/parse, an async job-queue audit poll) add
  // up to more than the config's default 120s test timeout.
  test.setTimeout(240_000)

  // ── 1. LOGIN ────────────────────────────────────────────────────────────
  await page.goto('/')
  await page.waitForURL(/\/login/)
  await expect(page.locator('input[name="password"]')).toBeVisible()

  await page.locator('input[name="password"]').fill('smoke-pw')
  await page.locator('button[type="submit"]').click()

  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await expect(page).not.toHaveURL(/\/login/)

  // ── 2. SF UPLOAD → PARSE → REPORT ──────────────────────────────────────
  await page.goto('/ada-audit')

  // Site Audit is the default tab; switch Scan type to SEO to reveal the
  // collapsed "Have Screaming Frog exports?" SF-upload section.
  await page.getByRole('button', { name: /^SEO/ }).click()
  await page.getByRole('button', { name: /Screaming Frog exports/i }).click()

  const seoUploadCard = page.locator('text=Upload CSV Files').locator('..')
  await expect(seoUploadCard).toBeVisible()

  // react-dropzone renders its own hidden file input inside the dropzone
  // area (distinct from the "Upload Folder" webkitdirectory input) — target
  // it by its accept attribute so it survives markup churn.
  const dropzoneInput = page.locator('input[type="file"][accept*="csv"]')
  await dropzoneInput.setInputFiles([
    path.join(FIXTURE_DIR, 'internal_all.csv'),
    path.join(FIXTURE_DIR, 'response_codes.csv'),
  ])

  // Both core exports present → "Analyze N Files" becomes enabled.
  const analyzeButton = page.getByRole('button', { name: /^Analyze \d+ Files?$/ })
  await expect(analyzeButton).toBeEnabled({ timeout: 15_000 })
  await analyzeButton.click()

  // Parsing navigates to /seo-audits/results/<sessionId> and renders the
  // health-score heading once complete.
  await page.waitForURL(/\/seo-audits\/results\//, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /SEO Audit/i })).toBeVisible({ timeout: 30_000 })

  // ── 3. SINGLE-PAGE AUDIT → COMPLETE ─────────────────────────────────────
  await page.goto('/ada-audit')
  await page.getByRole('tab', { name: 'Single Page', exact: true }).click()

  await page.locator('#audit-url').fill('http://127.0.0.1:41234/')
  await page.getByRole('button', { name: 'Run Audit' }).click()

  await page.waitForURL(/\/ada-audit\/[^/]+$/, { timeout: 30_000 })

  // The audit runs async via the job queue; the results page polls and
  // router.refresh()es on the terminal poll. Wait (generously) for the
  // scorecard's "Score" label and WCAG compliance text to render.
  await expect(page.getByText('Score', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/compliant/i)).toBeVisible({ timeout: 10_000 })
})
