// lib/robots-check/service.ts
//
// D4 persist/read layer. Single-flight per clientId:domain follows
// lib/keywords/gsc-snapshot.ts, INCLUDING the crash lesson: the .finally()
// cleanup chain is a DERIVED promise that re-rejects — it carries its own
// no-op .catch, or a rejected run becomes an unhandledRejection and crashes
// the process.
//
// `changed` is computed at READ time (never persisted) so D5 can refine the
// comparison semantics without a backfill. Comparison evidence: robotsStatus,
// robots contentHash, and the ordered (url, contentHash, childrenHash)
// triples — childrenHash catches child-sitemap churn under a byte-identical
// index (Codex #2).

import { prisma } from '@/lib/db'
import type { RobotsCheck } from '@prisma/client'
import { runRobotsCheck } from './runner'
import { buildChangeSummary, type RobotsChangeSide, type RobotsChangeSummary } from './change-summary'
import {
  ROBOTS_CHECK_HISTORY_LIMIT,
  type RobotsCheckDetail,
  type RobotsCheckSource,
  type RobotsCheckSummary,
  type RobotsFetchStatus,
} from './types'

export interface StoredRobotsCheck {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
  /** D5: diff vs the exact total-order predecessor; null on first check or
   *  when the predecessor's detail is unreadable (mirrors changed:null). */
  changeSummary: RobotsChangeSummary | null
}

/** Structural guard for the fields the service and card actually read
 *  (plan-Codex #2): syntactically valid but malformed JSON (e.g.
 *  {"v":1,"sitemaps":[null]}) must decode to null, never throw downstream. */
function parseDetail(json: string): RobotsCheckDetail | null {
  try {
    const parsed = JSON.parse(json) as RobotsCheckDetail
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null
    const r = parsed.robots
    if (!r || typeof r !== 'object' || typeof r.status !== 'string') return null
    if (!Array.isArray(r.issues) || !Array.isArray(r.blockedBots) || !Array.isArray(r.sitemapUrls)) return null
    if (!Array.isArray(parsed.sitemaps)) return null
    for (const s of parsed.sitemaps) {
      if (!s || typeof s !== 'object' || typeof s.url !== 'string' || typeof s.ok !== 'boolean') return null
      if (s.contentHash !== null && typeof s.contentHash !== 'string') return null
      if (s.childrenHash !== null && typeof s.childrenHash !== 'string') return null
      if (!Array.isArray(s.issues)) return null
    }
    if (!parsed.totals || typeof parsed.totals !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** Comparison evidence; JSON.stringify avoids delimiter ambiguity in URLs
 *  (plan-Codex #2). Null when the detail is unreadable. */
function evidenceOf(row: Pick<RobotsCheck, 'robotsStatus' | 'robotsContentHash' | 'detailJson'>): string | null {
  const detail = parseDetail(row.detailJson)
  if (!detail) return null
  return JSON.stringify([
    row.robotsStatus,
    row.robotsContentHash,
    detail.sitemaps.map((s) => [s.url, s.contentHash, s.childrenHash]),
  ])
}

function changedVs(prev: RobotsCheck | null | undefined, row: RobotsCheck): boolean | null {
  if (!prev) return null
  const a = evidenceOf(prev)
  const b = evidenceOf(row)
  if (a === null || b === null) return null
  return a !== b
}

function changeSummaryVs(prev: RobotsCheck | null, curr: RobotsChangeSide): RobotsChangeSummary | null {
  if (!prev) return null
  const prevDetail = parseDetail(prev.detailJson)
  if (!prevDetail) return null
  return buildChangeSummary({ detail: prevDetail, robotsContent: prev.robotsContent }, curr)
}

function toSummary(row: RobotsCheck, changed: boolean | null): RobotsCheckSummary {
  return {
    id: row.id,
    domain: row.domain,
    source: row.source,
    robotsStatus: row.robotsStatus as RobotsFetchStatus,
    sitemapUrlTotal: row.sitemapUrlTotal,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    changed,
    createdAt: row.createdAt.toISOString(),
  }
}

// ── Single-flight ───────────────────────────────────────────────────────────
// Entry installed synchronously (no await between lookup and set), so two
// concurrent calls for the same key always observe one in-flight promise.
const inFlight = new Map<string, Promise<StoredRobotsCheck>>()

export function runAndStoreRobotsCheck(
  clientId: number,
  domain: string,
  opts: { source: RobotsCheckSource },
): Promise<StoredRobotsCheck> {
  if (opts.source !== 'manual' && opts.source !== 'scheduled') {
    return Promise.reject(new Error('invalid_source'))
  }
  const key = `${clientId}:${domain}`
  const existing = inFlight.get(key)
  // A joiner gets the same row; the FIRST caller's source is what is stored
  // (documented in the spec — both callers observe identical data).
  if (existing) return existing

  const promise = (async (): Promise<StoredRobotsCheck> => {
    const { detail, robotsContent } = await runRobotsCheck(domain)
    const row = await prisma.robotsCheck.create({
      data: {
        clientId,
        domain,
        source: opts.source,
        robotsStatus: detail.robots.status,
        robotsContentHash: detail.robots.contentHash,
        robotsContent,
        sitemapUrlTotal: detail.totals.sitemapUrlTotal,
        errorCount: detail.totals.errors,
        warningCount: detail.totals.warnings,
        detailJson: JSON.stringify(detail),
      },
    })
    const prev = await prisma.robotsCheck.findFirst({
      // Exact total-order predecessor predicate — identical to
      // getRobotsCheck's (plan-Codex #1).
      where: {
        clientId,
        domain,
        OR: [
          { createdAt: { lt: row.createdAt } },
          { createdAt: row.createdAt, id: { lt: row.id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return {
      summary: toSummary(row, changedVs(prev, row)),
      detail,
      changeSummary: changeSummaryVs(prev, { detail, robotsContent }),
    }
  })()

  inFlight.set(key, promise)
  const cleanup = promise.finally(() => {
    inFlight.delete(key)
  })
  cleanup.catch(() => { /* rejection already surfaces via the returned promise */ })
  return promise
}

/** Newest-first summaries, capped at the history limit, pairwise changed
 *  within the SAME domain. When a row's predecessor is not inside the
 *  fetched window (interleaved multi-domain lists), it is fetched with a
 *  targeted exact total-order query — at most one extra query per domain
 *  present in the window (plan-Codex #1). Retention retains +1 per
 *  (client, domain) so the true oldest row's predecessor exists in the DB. */
export async function listRobotsChecks(clientId: number, domain?: string): Promise<RobotsCheckSummary[]> {
  const rows = await prisma.robotsCheck.findMany({
    where: { clientId, ...(domain ? { domain } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ROBOTS_CHECK_HISTORY_LIMIT + 1,
  })
  const visible = rows.slice(0, ROBOTS_CHECK_HISTORY_LIMIT)
  const summaries: RobotsCheckSummary[] = []
  for (let i = 0; i < visible.length; i++) {
    const row = visible[i]
    let prev: RobotsCheck | null = rows.slice(i + 1).find((r) => r.domain === row.domain) ?? null
    if (!prev) {
      prev = await prisma.robotsCheck.findFirst({
        where: {
          clientId,
          domain: row.domain,
          OR: [
            { createdAt: { lt: row.createdAt } },
            { createdAt: row.createdAt, id: { lt: row.id } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    }
    summaries.push(toSummary(row, changedVs(prev, row)))
  }
  return summaries
}

export async function getRobotsCheck(clientId: number, checkId: number): Promise<StoredRobotsCheck | null> {
  const row = await prisma.robotsCheck.findFirst({ where: { id: checkId, clientId } })
  if (!row) return null
  const detail = parseDetail(row.detailJson)
  if (!detail) return null
  const prev = await prisma.robotsCheck.findFirst({
    where: {
      clientId,
      domain: row.domain,
      id: { not: row.id },
      OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return {
    summary: toSummary(row, changedVs(prev, row)),
    detail,
    changeSummary: changeSummaryVs(prev, { detail, robotsContent: row.robotsContent }),
  }
}
