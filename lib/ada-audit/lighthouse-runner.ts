// lib/ada-audit/lighthouse-runner.ts
import type { Page } from 'puppeteer-core'
import type {
  LighthouseSummary,
  LighthouseFailure,
  LighthouseCategory,
  LighthouseAccessibility,
  LighthouseA11yAudit,
  LighthouseA11yFailingElement,
  LighthouseA11yGroup,
  CwvStatus,
} from './lighthouse-types'

// Per https://web.dev/lcp, https://web.dev/cls, https://web.dev/tbt
function lcpStatus(ms: number): CwvStatus {
  if (ms <= 2500) return 'pass'
  if (ms <= 4000) return 'needs-improvement'
  return 'fail'
}
function clsStatus(v: number): CwvStatus {
  if (v <= 0.1) return 'pass'
  if (v <= 0.25) return 'needs-improvement'
  return 'fail'
}
function tbtStatus(ms: number): CwvStatus {
  if (ms <= 200) return 'pass'
  if (ms <= 600) return 'needs-improvement'
  return 'fail'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lhr = any

// topFailures lives at the perf/best-practices view — a11y is excluded since
// it has its own dedicated section below.
const TOP_FAILURE_CATEGORIES: LighthouseCategory[] = ['performance', 'best-practices']

function extractAccessibility(lhr: Lhr): LighthouseAccessibility {
  const score = Math.round(((lhr.categories?.accessibility?.score ?? 0) as number) * 100)
  const categoryGroups = (lhr.categoryGroups ?? {}) as Record<string, { title?: string; description?: string }>
  const auditRefs = (lhr.categories?.accessibility?.auditRefs ?? []) as Array<{ id: string; group?: string }>

  // Preserve Lighthouse's auditRef order within each group; preserve group
  // first-appearance order across the section.
  const order: string[] = []
  const buckets = new Map<string, LighthouseA11yAudit[]>()

  for (const ref of auditRefs) {
    const groupId = ref.group
    if (!groupId) continue
    const a = lhr.audits?.[ref.id]
    if (!a) continue
    // Failures only: drop passes (score === 1), N/A and manual (score === null).
    if (a.score === null || a.score === undefined) continue
    if (a.score >= 1) continue

    const elements: LighthouseA11yFailingElement[] = []
    for (const item of (a.details?.items ?? []) as Array<{ node?: { snippet?: string; selector?: string } }>) {
      const snippet = item.node?.snippet
      if (!snippet) continue
      elements.push(item.node?.selector ? { snippet, selector: item.node.selector } : { snippet })
    }

    if (!buckets.has(groupId)) {
      order.push(groupId)
      buckets.set(groupId, [])
    }
    buckets.get(groupId)!.push({
      id: a.id ?? ref.id,
      title: a.title ?? ref.id,
      description: a.description ?? '',
      failingElements: elements,
    })
  }

  const groups: LighthouseA11yGroup[] = []
  for (const groupId of order) {
    const meta = categoryGroups[groupId]
    if (!meta) continue  // unknown group — skip rather than render a stub
    groups.push({
      id: groupId,
      title: meta.title ?? groupId,
      description: meta.description ?? '',
      audits: buckets.get(groupId) ?? [],
    })
  }

  return { score, groups }
}

export function extractSummary(lhr: Lhr): LighthouseSummary {
  const cat = (key: LighthouseCategory) =>
    Math.round(((lhr.categories?.[key]?.score ?? 0) as number) * 100)

  const audit = (id: string) => lhr.audits?.[id]?.numericValue ?? 0

  const failures: LighthouseFailure[] = []
  for (const [catKey, category] of Object.entries(lhr.categories ?? {}) as [string, Lhr][]) {
    if (!TOP_FAILURE_CATEGORIES.includes(catKey as LighthouseCategory)) continue
    for (const ref of category.auditRefs ?? []) {
      const a = lhr.audits?.[ref.id]
      if (!a) continue
      const score = a.score
      if (score === null || score === undefined) continue
      if (score >= 0.9) continue
      failures.push({
        id: a.id ?? ref.id,
        title: a.title ?? ref.id,
        score,
        displayValue: a.displayValue,
        category: catKey as LighthouseCategory,
      })
    }
  }
  failures.sort((a, b) => (a.score ?? 1) - (b.score ?? 1))

  return {
    scores: {
      performance:   cat('performance'),
      accessibility: cat('accessibility'),
      bestPractices: cat('best-practices'),
    },
    cwv: {
      lcp: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift'),
      tbt: audit('total-blocking-time'),
      lcpStatus: lcpStatus(audit('largest-contentful-paint')),
      clsStatus: clsStatus(audit('cumulative-layout-shift')),
      tbtStatus: tbtStatus(audit('total-blocking-time')),
    },
    topFailures: failures.slice(0, 5),
    accessibility: extractAccessibility(lhr),
  }
}

const LIGHTHOUSE_ENABLED = (process.env.LIGHTHOUSE_ENABLED ?? 'true') !== 'false'
const LIGHTHOUSE_TIMEOUT_MS = parseInt(process.env.LIGHTHOUSE_TIMEOUT_MS ?? '60000', 10)

export const isLighthouseEnabled = () => LIGHTHOUSE_ENABLED

export interface RunLighthouseResult {
  summary: LighthouseSummary | null
  error?: string
}

// Narrow boundary type for the Lighthouse function — LH 13's exported types
// fight with puppeteer-core's Page type, so we cast at the import boundary.
type LighthouseFn = (
  url: string,
  flags?: unknown,
  config?: unknown,
  page?: Page,
) => Promise<{ lhr: Lhr } | undefined>

/**
 * Run Lighthouse against an existing puppeteer Page. Lighthouse owns the navigation
 * (page.goto is NOT called by us beforehand). After this returns, the page is loaded
 * to `url` but its CDP state (network throttling, CPU throttling, cache) has been
 * mutated — callers must reset before running other tools.
 */
export async function runLighthouse(
  url: string,
  page: Page,
): Promise<RunLighthouseResult> {
  if (!LIGHTHOUSE_ENABLED) return { summary: null }

  let lighthouse: LighthouseFn
  try {
    lighthouse = (await import('lighthouse')).default as unknown as LighthouseFn
  } catch (e) {
    return { summary: null, error: `lighthouse import failed: ${(e as Error).message}` }
  }

  // puppeteer-core uses CDP; lighthouse v11+ accepts a puppeteer-core Page directly
  // via the `page` option in `lighthouse(url, flags, config, page)`. The 4-arg form
  // tells LH to attach to our existing browser instead of launching its own.
  try {
    const result = await Promise.race([
      lighthouse(url, {
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: true,
        },
      }, undefined, page),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Lighthouse timed out after ${LIGHTHOUSE_TIMEOUT_MS}ms`)), LIGHTHOUSE_TIMEOUT_MS),
      ),
    ])

    if (!result || !result.lhr) {
      return { summary: null, error: 'Lighthouse returned no report' }
    }

    const summary = extractSummary(result.lhr)
    return { summary }
  } catch (e) {
    return { summary: null, error: (e as Error).message }
  }
}

/**
 * Reset CDP state that Lighthouse mutates so subsequent tools (axe) run under
 * default conditions, not LH's emulated slow network + 4x CPU throttle.
 */
export async function resetCdpAfterLighthouse(page: Page): Promise<void> {
  const client = await page.target().createCDPSession()
  try {
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await client.send('Network.setCacheDisabled', { cacheDisabled: false })
  } finally {
    await client.detach().catch(() => {})
  }
}
