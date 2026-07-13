// lib/robots-check/change-summary.ts
//
// D5 pure, CLIENT-SAFE change summary between two RobotsCheck snapshots.
// Shared by the alert email builder (server) and the card's "changed vs
// previous" section (client) — must never import server-only modules.
//
// Completeness invariant (spec Codex #4): whenever D4's alert evidence
// differs (robotsStatus + robots contentHash + ordered
// (url,contentHash,childrenHash) triples), at least one field here is
// non-null/non-empty. The line diff is a MULTISET (order-insensitive) by
// design, so robotsContentChanged and sitemaps.orderChanged carry the
// reorder/formatting-only cases the diff can't show.

import type { RobotsCheckDetail, RobotsFetchStatus } from './types'
import { ROBOTS_DIFF_MAX_LINES, ROBOTS_DIFF_MAX_LINE_CHARS } from './types'

export interface RobotsChangeSide {
  detail: RobotsCheckDetail
  robotsContent: string | null
}

export interface RobotsChangeSummary {
  robotsStatus: { prev: RobotsFetchStatus; curr: RobotsFetchStatus } | null
  /** Robots content hashes differ — fires even when the line diff is empty
   *  (reorder / whitespace-only edits). */
  robotsContentChanged: boolean
  robotsDiff: { added: string[]; removed: string[]; truncated: boolean } | null
  blockedBots: { added: string[]; removed: string[] } | null
  sitemaps: {
    added: string[]
    removed: string[]
    changed: Array<{ url: string; urlCountPrev: number | null; urlCountCurr: number | null; childrenChanged: boolean }>
    orderChanged: boolean
  } | null
  sitemapUrlTotal: { prev: number | null; curr: number | null } | null
  counts: { errorsPrev: number; errorsCurr: number; warningsPrev: number; warningsCurr: number } | null
}

function lineCounts(body: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    map.set(line, (map.get(line) ?? 0) + 1)
  }
  return map
}

function multisetDiff(prev: string, curr: string): { added: string[]; removed: string[]; truncated: boolean } {
  const a = lineCounts(prev)
  const b = lineCounts(curr)
  const added: string[] = []
  const removed: string[] = []
  let truncated = false
  const capped = (line: string): string => {
    if (line.length <= ROBOTS_DIFF_MAX_LINE_CHARS) return line
    truncated = true // plan-Codex #5: bounded by bytes, not only line count
    return line.slice(0, ROBOTS_DIFF_MAX_LINE_CHARS)
  }
  for (const [line, n] of b) {
    let surplus = n - (a.get(line) ?? 0)
    while (surplus-- > 0) {
      if (added.length >= ROBOTS_DIFF_MAX_LINES) { truncated = true; break }
      added.push(capped(line))
    }
  }
  for (const [line, n] of a) {
    let surplus = n - (b.get(line) ?? 0)
    while (surplus-- > 0) {
      if (removed.length >= ROBOTS_DIFF_MAX_LINES) { truncated = true; break }
      removed.push(capped(line))
    }
  }
  return { added, removed, truncated }
}

function setDiff(prev: string[], curr: string[]): { added: string[]; removed: string[] } {
  const a = new Set(prev)
  const b = new Set(curr)
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) }
}

interface SitemapObs { url: string; contentHash: string | null; childrenHash: string | null; urlCount: number | null }

/** (url, ordinal) identity: the Nth occurrence of a URL pairs with the Nth
 *  occurrence on the other side — duplicate URLs never collapse (Codex #4). */
function keyedSitemaps(detail: RobotsCheckDetail): Map<string, SitemapObs> {
  const seen = new Map<string, number>()
  const out = new Map<string, SitemapObs>()
  for (const s of detail.sitemaps) {
    const ordinal = seen.get(s.url) ?? 0
    seen.set(s.url, ordinal + 1)
    out.set(`${ordinal}\n${s.url}`, { url: s.url, contentHash: s.contentHash, childrenHash: s.childrenHash, urlCount: s.urlCount })
  }
  return out
}

export function buildChangeSummary(prev: RobotsChangeSide, curr: RobotsChangeSide): RobotsChangeSummary {
  const pr = prev.detail.robots
  const cr = curr.detail.robots

  const robotsStatus = pr.status === cr.status ? null : { prev: pr.status, curr: cr.status }
  const robotsContentChanged = pr.contentHash !== cr.contentHash
  const robotsDiff =
    robotsContentChanged && prev.robotsContent !== null && curr.robotsContent !== null
      ? multisetDiff(prev.robotsContent, curr.robotsContent)
      : null

  const bots = setDiff(pr.blockedBots, cr.blockedBots)
  const blockedBots = bots.added.length || bots.removed.length ? bots : null

  const pk = keyedSitemaps(prev.detail)
  const ck = keyedSitemaps(curr.detail)
  const added: string[] = []
  const removed: string[] = []
  const changed: Array<{ url: string; urlCountPrev: number | null; urlCountCurr: number | null; childrenChanged: boolean }> = []
  for (const [key, c] of ck) {
    const p = pk.get(key)
    if (!p) { added.push(c.url); continue }
    if (p.contentHash !== c.contentHash || p.childrenHash !== c.childrenHash) {
      changed.push({ url: c.url, urlCountPrev: p.urlCount, urlCountCurr: c.urlCount, childrenChanged: p.childrenHash !== c.childrenHash })
    }
  }
  for (const [key, p] of pk) {
    if (!ck.has(key)) removed.push(p.url)
  }
  const orderChanged =
    added.length === 0 && removed.length === 0 &&
    prev.detail.sitemaps.map((s) => s.url).join('\n') !== curr.detail.sitemaps.map((s) => s.url).join('\n')
  const sitemaps =
    added.length || removed.length || changed.length || orderChanged
      ? { added, removed, changed, orderChanged }
      : null

  const pt = prev.detail.totals
  const ct = curr.detail.totals
  const sitemapUrlTotal =
    pt.sitemapUrlTotal === ct.sitemapUrlTotal ? null : { prev: pt.sitemapUrlTotal, curr: ct.sitemapUrlTotal }
  const counts =
    pt.errors === ct.errors && pt.warnings === ct.warnings
      ? null
      : { errorsPrev: pt.errors, errorsCurr: ct.errors, warningsPrev: pt.warnings, warningsCurr: ct.warnings }

  return { robotsStatus, robotsContentChanged, robotsDiff, blockedBots, sitemaps, sitemapUrlTotal, counts }
}
