// lib/robots-check/runner.ts
//
// D4 server-side check runner. Pure-ish: ALL I/O rides injected deps
// (default = the real lib/seo-fetch primitives, which wrap safeFetch —
// this module adds ZERO new fetch paths). Never touches the DB.
//
// Honest-flags contract: every cap or budget skip is counted and surfaced
// (sitemapsSkipped / childrenSkipped / childrenExcluded /
// timeBudgetExhausted) — no silent truncation.

import { createHash } from 'node:crypto'
import {
  fetchRobotsTxt,
  fetchSitemapXml,
  collectSitemapPageUrls,
  type SeoFetchResult,
} from '@/lib/seo-fetch/fetch'
import { parseRobotsTxt } from '@/lib/seo-fetch/robots-parse'
import {
  parseSitemapXml,
  isSitemapIndex,
  extractChildSitemapLocs,
} from '@/lib/seo-fetch/sitemap-parse'
import {
  CONVENTION_SITEMAP_PATHS,
  ROBOTS_CHECK_MAX_CHILDREN,
  ROBOTS_CHECK_MAX_SITEMAPS,
  ROBOTS_CHECK_TIME_BUDGET_MS,
  type RobotsCheckDetail,
  type SitemapCheckEntry,
  type SitemapChildObservation,
} from './types'

export interface RunnerDeps {
  fetchRobotsTxt: (baseUrl: string) => Promise<SeoFetchResult>
  fetchSitemapXml: (url: string) => Promise<SeoFetchResult>
  now: () => number
}

export interface RobotsCheckRunResult {
  detail: RobotsCheckDetail
  /** Raw robots body for the robotsContent column — server-only, never in detailJson (Codex #1). */
  robotsContent: string | null
}

const realDeps: RunnerDeps = { fetchRobotsTxt, fetchSitemapXml, now: Date.now }

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** www-insensitive host normalization for the child filter (Codex #6). */
function normHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export async function runRobotsCheck(
  domain: string,
  deps: RunnerDeps = realDeps,
): Promise<RobotsCheckRunResult> {
  const startedAt = deps.now()
  const budgetLeft = () => deps.now() - startedAt < ROBOTS_CHECK_TIME_BUDGET_MS
  let timeBudgetExhausted = false

  // ── Robots phase ─────────────────────────────────────────────────────────
  const robotsRes = await deps.fetchRobotsTxt(`https://${domain}`)
  let robotsContent: string | null = null
  let robots: RobotsCheckDetail['robots']
  if (robotsRes.ok) {
    const parsed = parseRobotsTxt(robotsRes.text)
    robotsContent = robotsRes.text
    robots = {
      status: 'ok',
      httpStatus: robotsRes.status,
      failure: null,
      contentHash: sha256Hex(robotsRes.text),
      issues: parsed.issues,
      blockedBots: parsed.blockedBots,
      sitemapUrls: parsed.sitemapUrls,
    }
  } else {
    const missing = robotsRes.failure === 'http-error' && (robotsRes.status === 404 || robotsRes.status === 410)
    robots = {
      status: missing ? 'missing' : 'unreachable',
      httpStatus: robotsRes.status,
      failure: robotsRes.failure,
      contentHash: null,
      issues: [],
      blockedBots: [],
      sitemapUrls: [],
    }
  }

  // ── One sitemap entry from an already-fetched result ─────────────────────
  async function buildEntry(
    url: string,
    source: 'robots' | 'convention',
    res: SeoFetchResult,
  ): Promise<SitemapCheckEntry> {
    if (!res.ok) {
      return {
        url, source, ok: false, httpStatus: res.status, failure: res.failure,
        isIndex: false, urlCount: null, childrenTotal: 0, childrenExcluded: 0,
        childrenFailed: 0, childrenSkipped: 0, contentHash: null,
        children: [], childrenHash: null, issues: [],
      }
    }
    const xml = res.text
    const parsed = parseSitemapXml(xml)
    const index = isSitemapIndex(xml)
    const parentHost = hostOf(res.finalUrl) ?? domain
    const parentNorm = normHost(parentHost)
    const isSameDomain = (u: string) => {
      const h = hostOf(u)
      return h !== null && normHost(h) === parentNorm
    }

    // Budget-capped child fetcher over the FROZEN collector: a skipped child
    // registers as null (= failed) inside collectSitemapPageUrls, so real
    // failures are derived by subtraction, clamped (Codex spec review).
    // The synchronous prelude (cap check, observation slot) runs in call
    // order even though the collector fires batches of 5 concurrently.
    let attempted = 0
    let skipped = 0
    const observations: SitemapChildObservation[] = []
    const cappedFetch = async (u: string): Promise<string | null> => {
      if (attempted >= ROBOTS_CHECK_MAX_CHILDREN || !budgetLeft()) {
        if (!budgetLeft()) timeBudgetExhausted = true
        skipped++
        return null
      }
      attempted++
      const slot = observations.length
      observations.push({ url: u, contentHash: null })
      const childRes = await deps.fetchSitemapXml(u)
      if (!childRes.ok) return null
      observations[slot] = { url: u, contentHash: sha256Hex(childRes.text) }
      return childRes.text
    }

    const collected = await collectSitemapPageUrls(xml, isSameDomain, cappedFetch)
    const childrenExcluded = index
      ? Math.max(0, extractChildSitemapLocs(xml).length - collected.childrenTotal)
      : 0
    const childrenHash = observations.length
      ? sha256Hex(observations.map((o) => `${o.url}\n${o.contentHash ?? 'failed'}`).join('\n'))
      : null

    return {
      url,
      source,
      ok: true,
      httpStatus: res.status,
      failure: null,
      isIndex: index,
      urlCount: collected.urls.length,
      childrenTotal: collected.childrenTotal,
      childrenExcluded,
      childrenFailed: Math.max(0, collected.childrenFailed - skipped),
      childrenSkipped: skipped,
      contentHash: sha256Hex(xml),
      children: observations,
      childrenHash,
      issues: parsed.issues,
    }
  }

  // ── Sitemap target selection ─────────────────────────────────────────────
  const sitemaps: SitemapCheckEntry[] = []
  let sitemapsSkipped = 0

  if (robots.sitemapUrls.length > 0) {
    const targets = robots.sitemapUrls.slice(0, ROBOTS_CHECK_MAX_SITEMAPS)
    sitemapsSkipped = robots.sitemapUrls.length - targets.length
    for (const url of targets) {
      if (!budgetLeft()) {
        timeBudgetExhausted = true
        sitemapsSkipped += targets.length - sitemaps.length
        break
      }
      sitemaps.push(await buildEntry(url, 'robots', await deps.fetchSitemapXml(url)))
    }
  } else {
    // Convention probing (Codex #4): a probe wins only when the fetch is ok
    // AND parseSitemapXml recognizes a sitemap document. Otherwise record
    // the most informative single outcome so the check is honest about
    // having looked.
    let lastOkUnrecognized: { url: string; res: SeoFetchResult & { ok: true } } | null = null
    let lastFailed: { url: string; res: SeoFetchResult & { ok: false } } | null = null
    for (const path of CONVENTION_SITEMAP_PATHS) {
      if (!budgetLeft()) {
        timeBudgetExhausted = true
        break
      }
      const url = `https://${domain}${path}`
      const res = await deps.fetchSitemapXml(url)
      if (!res.ok) {
        lastFailed = { url, res }
        continue
      }
      const parsed = parseSitemapXml(res.text)
      // Recognition = parsed.valid ONLY (plan-Codex #3): malformed XML that
      // happens to contain a usable <loc> must NOT win a convention probe.
      // Valid empty sitemap documents remain valid and DO win.
      const recognized = parsed.valid
      if (recognized) {
        sitemaps.push(await buildEntry(url, 'convention', res))
        lastOkUnrecognized = null
        lastFailed = null
        break
      }
      lastOkUnrecognized = { url, res }
    }
    if (sitemaps.length === 0 && lastOkUnrecognized) {
      const { url, res } = lastOkUnrecognized
      sitemaps.push({
        url, source: 'convention', ok: false, httpStatus: res.status,
        failure: 'unrecognized', isIndex: false, urlCount: null,
        childrenTotal: 0, childrenExcluded: 0, childrenFailed: 0,
        childrenSkipped: 0, contentHash: sha256Hex(res.text),
        children: [], childrenHash: null, issues: parseSitemapXml(res.text).issues,
      })
    } else if (sitemaps.length === 0 && lastFailed) {
      sitemaps.push(await buildEntry(lastFailed.url, 'convention', lastFailed.res))
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const issueCounts = (sev: 'error' | 'warning') =>
    robots.issues.filter((i) => i.severity === sev).length +
    sitemaps.reduce((n, s) => n + s.issues.filter((i) => i.severity === sev).length, 0)
  const failedEntries = sitemaps.filter((s) => !s.ok).length
  const errors = issueCounts('error') + (robots.status === 'unreachable' ? 1 : 0) + failedEntries
  const warnings = issueCounts('warning') + (robots.status === 'missing' ? 1 : 0)
  const okCounts = sitemaps.filter((s): s is SitemapCheckEntry & { urlCount: number } => s.ok && s.urlCount !== null)
  const sitemapUrlTotal = okCounts.length > 0 ? okCounts.reduce((n, s) => n + s.urlCount, 0) : null

  return {
    detail: {
      v: 1,
      domain,
      robots,
      sitemaps,
      sitemapsSkipped,
      timeBudgetExhausted,
      totals: { sitemapUrlTotal, errors, warnings },
    },
    robotsContent,
  }
}
