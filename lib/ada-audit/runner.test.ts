// lib/ada-audit/runner.test.ts
//
// C11 PR1 Task 2: render-only runner path. The puppeteer runner is excluded
// from coverage (vitest.config.ts) — these tests exercise the render-only
// control flow by mocking the browser pool, safe-URL validation, the
// Lighthouse provider ('off' so we own navigation), navigation/settle, and the
// injected link/SEO harvest. The .toString()-injected on-page functions are
// never invoked (harvestLinks is mocked), so the SWC-helper invariant is moot.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mocks (must be declared before importing the module under test) ─────────
vi.mock('@/lib/ada-audit/browser-pool', () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn(async () => undefined),
}))
vi.mock('@/lib/security/safe-url', () => ({
  assertSafeHttpUrl: vi.fn(async (input: string | URL) => new URL(String(input))),
}))
vi.mock('@/lib/ada-audit/lighthouse-provider', () => ({
  getLighthouseProvider: vi.fn(() => 'off'),
}))
vi.mock('@/lib/ada-audit/lighthouse-runner', () => ({
  runLighthouse: vi.fn(),
  resetCdpAfterLighthouse: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/page-load', () => ({
  gotoWithRetryOn5xx: vi.fn(),
  postLoadSettle: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ada-audit/link-harvest', () => ({
  harvestLinks: vi.fn(async () => ({ targets: [], truncated: false, pageSeo: null })),
}))
vi.mock('@/lib/ada-audit/pdf-discovery', () => ({
  harvestPdfLinks: vi.fn(async () => []),
}))

const { acquirePage, releasePage } = await import('@/lib/ada-audit/browser-pool')
const { gotoWithRetryOn5xx } = await import('@/lib/ada-audit/page-load')
const { harvestLinks } = await import('@/lib/ada-audit/link-harvest')
const { harvestPdfLinks } = await import('@/lib/ada-audit/pdf-discovery')
const { runAxeAudit } = await import('./runner')

function makeResponse() {
  return {
    status: () => 200,
    ok: () => true,
    statusText: () => 'OK',
    headers: () => ({ 'content-type': 'text/html; charset=utf-8' }),
    url: () => 'https://example.edu/',
    request: () => ({ redirectChain: () => [] }),
  }
}

function makePage() {
  return {
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn(),
    // Guarded so a regression that runs axe in render-only mode fails loudly
    // instead of silently returning a fabricated result.
    evaluate: vi.fn(async () => {
      throw new Error('page.evaluate must not run in render-only mode')
    }),
    addScriptTag: vi.fn(async () => {
      throw new Error('addScriptTag (axe injection) must not run in render-only mode')
    }),
    setExtraHTTPHeaders: vi.fn(async () => undefined),
    goto: vi.fn(),
  }
}

describe('runAxeAudit renderOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(acquirePage as ReturnType<typeof vi.fn>).mockResolvedValue(makePage())
    ;(gotoWithRetryOn5xx as ReturnType<typeof vi.fn>).mockResolvedValue(makeResponse())
    ;(harvestLinks as ReturnType<typeof vi.fn>).mockResolvedValue({
      targets: [{ url: 'https://example.edu/about', type: 'internal-link' }],
      truncated: false,
      pageSeo: null,
    })
  })

  it('C11: renderOnly returns kind:rendered with harvest and no axe', async () => {
    const res = await runAxeAudit('https://example.edu/', 'wcag21aa', undefined, {
      auditId: 'a1',
      renderOnly: true,
    })
    expect(res.kind).toBe('rendered')
    if (res.kind === 'rendered') {
      expect(res).not.toHaveProperty('axe')
      expect(res).not.toHaveProperty('lighthouseSummary')
      expect(Array.isArray(res.harvestedLinks)).toBe(true)
      expect(res.harvestedLinks.length).toBe(1)
      expect(res.harvestedLinksTruncated).toBe(false)
      expect(res.harvestedPageSeo).toBeNull()
    }
    // Both ADA-only phases skipped.
    expect(harvestPdfLinks).not.toHaveBeenCalled()
    // Harvest ran for the render-only path.
    expect(harvestLinks).toHaveBeenCalledTimes(1)
    // Page released exactly once (finally).
    expect(releasePage).toHaveBeenCalledTimes(1)
  })
})
