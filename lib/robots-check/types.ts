// lib/robots-check/types.ts
//
// D4 client-safe types + constants for client-attached robots/sitemap
// checks. Imported by the card component AND the server layer — must never
// import server-only modules. Issue types come from the client-safe D3
// parse modules.

import type { RobotsIssue } from '@/lib/seo-fetch/robots-parse'
import type { SitemapIssue } from '@/lib/seo-fetch/sitemap-parse'

export const ROBOTS_CHECK_DETAIL_VERSION = 1
/** Declared sitemaps fetched per check; overflow -> sitemapsSkipped. */
export const ROBOTS_CHECK_MAX_SITEMAPS = 5
/** Index children expanded per sitemap; overflow -> childrenSkipped. */
export const ROBOTS_CHECK_MAX_CHILDREN = 20
/** List/display cap. Retention keeps LIMIT+1 per (client, domain): one
 *  hidden predecessor so the oldest VISIBLE row's `changed` flag never
 *  flips to null when retention prunes its comparison target (Codex #3). */
export const ROBOTS_CHECK_HISTORY_LIMIT = 20
/** Soft deadline checked before every fetch. Worst case overshoot is one
 *  in-flight batch's 15s fetch timeout: hard bound ~= budget + 15s. */
export const ROBOTS_CHECK_TIME_BUDGET_MS = 60_000
/** Crawler-convention fallback probe order (matches sitemap-crawler). */
export const CONVENTION_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/wp-sitemap.xml',
] as const

export type RobotsFetchStatus = 'ok' | 'missing' | 'unreachable'
export type RobotsCheckSource = 'manual' | 'scheduled'

export interface SitemapChildObservation {
  url: string
  /** sha256 hex of the child XML actually fetched; null = fetch failed. */
  contentHash: string | null
}

export interface SitemapCheckEntry {
  url: string
  /** Declared in robots.txt vs convention-path fallback probe. */
  source: 'robots' | 'convention'
  ok: boolean
  httpStatus: number | null
  /** SeoFetchFailure when the fetch failed, or the runner-level
   *  'unrecognized' when a convention probe fetched ok but parseSitemapXml
   *  did not recognize a sitemap document (Codex #4). Null when ok. */
  failure: string | null
  isIndex: boolean
  /** Total page locs (one-level index expansion); null when !ok. */
  urlCount: number | null
  /** ELIGIBLE children (the frozen collector host-filters BEFORE counting). */
  childrenTotal: number
  /** Child declarations dropped by the parent-host filter (Codex #6). */
  childrenExcluded: number
  /** Real fetch failures among expanded children (skips subtracted, clamped). */
  childrenFailed: number
  /** Children not attempted: beyond ROBOTS_CHECK_MAX_CHILDREN or time budget. */
  childrenSkipped: number
  /** sha256 hex of the fetched XML text; null when !ok. */
  contentHash: string | null
  /** (url, hash) per child actually fetched, in call order — child-level
   *  change evidence for indexes whose own XML is byte-identical (Codex #2). */
  children: SitemapChildObservation[]
  /** sha256 over the ordered children observations; null when none. */
  childrenHash: string | null
  /** parseSitemapXml issues for the top-level document only. */
  issues: SitemapIssue[]
}

export interface RobotsCheckDetail {
  v: 1
  domain: string
  robots: {
    status: RobotsFetchStatus
    httpStatus: number | null
    failure: string | null
    contentHash: string | null
    issues: RobotsIssue[]
    blockedBots: string[]
    sitemapUrls: string[]
  }
  sitemaps: SitemapCheckEntry[]
  /** Declared sitemaps not fetched (cap overflow or time budget). */
  sitemapsSkipped: number
  timeBudgetExhausted: boolean
  totals: {
    /** Sum of urlCount over ok entries; null when NO entry is ok. */
    sitemapUrlTotal: number | null
    errors: number
    warnings: number
  }
}

export interface RobotsCheckSummary {
  id: number
  domain: string
  source: string
  robotsStatus: RobotsFetchStatus
  sitemapUrlTotal: number | null
  errorCount: number
  warningCount: number
  /** vs previous row same (client,domain); null = first check or
   *  corrupt/unreadable comparison target. Render null as em dash, never
   *  as "unchanged". */
  changed: boolean | null
  createdAt: string
}
