// lib/jobs/handlers/site-audit-discover.ts
//
// Durable-queue discovery + fan-out handler for site audits. One job per
// audit (dedupKey discover:<id>); owns the queued→running claim, page
// discovery, child-row creation, and site-audit-page fan-out. Making this a
// job (not inline work in processNext) is what makes the enqueue step itself
// crash-safe: a restart mid-fan-out re-queues the job, which resumes
// idempotently off the persisted discoveredUrls + the (siteAuditId, url)
// unique index on AdaAudit.
//
// One-at-a-time: the claim carries a NOT EXISTS guard over the transient
// statuses — the stateless promoter alone cannot enforce the invariant (two
// concurrent processNext calls can promote two different audits; see the
// Phase 3 spec). A claim that matches 0 rows on a still-queued audit means
// another audit is active: complete the job as a no-op; the active audit's
// finalize will re-promote this one with a fresh discover job.
//
// Zombie safety: discoveredUrls is persisted first-writer-wins (conditional
// on discoveredUrls IS NULL), so every attempt fans out the SAME URL list;
// child creation is per-row create with P2002 catch-and-skip
// (createMany.skipDuplicates is not supported on SQLite).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { discoverPages } from '@/lib/ada-audit/sitemap-crawler'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { enqueueJob } from '../queue'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'
import {
  SITE_AUDIT_PAGE_JOB_TYPE,
  settlePageFailure,
  type SiteAuditPageJob,
} from './site-audit-page'

export const SITE_AUDIT_DISCOVER_JOB_TYPE = 'site-audit-discover'

export interface SiteAuditDiscoverJob {
  siteAuditId: string
}

function assertDiscoverPayload(payload: unknown): SiteAuditDiscoverJob {
  const p = payload as Partial<SiteAuditDiscoverJob> | null
  if (!p || typeof p.siteAuditId !== 'string') {
    throw new Error('Invalid site-audit-discover job payload')
  }
  return p as SiteAuditDiscoverJob
}

function kickPromoter(): void {
  // Dynamic import mirrors site-audit-finalizer.ts — avoids a static
  // handler → queue-manager → jobs/queue → … cycle.
  void import('@/lib/ada-audit/queue-manager')
    .then((m) => m.processNext())
    .catch(() => {})
}

function parseUrlList(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null // corrupt legacy value — caller re-discovers + repairs
  }
}

export async function runSiteAuditDiscoverJob(payload: unknown): Promise<void> {
  const { siteAuditId } = assertDiscoverPayload(payload)

  // Conditional claim with the one-active guard. Raw SQL: startedAt and
  // updatedAt set manually (integer ms — raw SQL bypasses @updatedAt).
  const claimed = await prisma.$executeRaw`
    UPDATE "SiteAudit"
    SET "status" = 'running', "startedAt" = ${Date.now()}, "updatedAt" = ${Date.now()}
    WHERE "id" = ${siteAuditId}
      AND "status" = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM "SiteAudit"
        WHERE "status" IN ('running', 'pdfs-running', 'lighthouse-running')
      )`

  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { status: true, domain: true, clientId: true, wcagLevel: true, discoveredUrls: true },
  })
  if (!audit) return

  if (claimed !== 1) {
    if (audit.status === 'queued') {
      // Another audit holds the slot — no-op; the next finalize kick
      // re-promotes this audit with a fresh discover job.
      return
    }
    if (audit.status !== 'running') {
      // Terminal (cancelled/error/complete) — nothing to do; let the
      // promoter consider the next queued audit.
      kickPromoter()
      return
    }
    // status === 'running' → crash-resume: fall through.
  }

  // Resolve the URL list. First-writer-wins persist makes every attempt fan
  // out the same set.
  let urls = parseUrlList(audit.discoveredUrls)
  if (urls === null) {
    const result = await discoverPages(audit.domain)
    const discovered = [...new Set(result.urls)]
    const persisted = await prisma.siteAudit.updateMany({
      where: { id: siteAuditId, discoveredUrls: null },
      data: {
        discoveredUrls: JSON.stringify(discovered),
        pagesTotal: discovered.length,
        discoveryMode: result.mode,
        discoveryCapped: result.capped,
      },
    })
    if (persisted.count === 1) {
      urls = discovered
    } else {
      // A racing attempt persisted first (or the stored value was corrupt
      // and non-null) — re-read and prefer the stored set; fall back to the
      // fresh discovery for the corrupt case (the ensure-write below
      // repairs the stored value).
      const reread = await prisma.siteAudit.findUnique({
        where: { id: siteAuditId },
        select: { discoveredUrls: true },
      })
      urls = parseUrlList(reread?.discoveredUrls ?? null) ?? discovered
    }
  }

  // Dedupe defensively (stored legacy sets may contain duplicates — the
  // unique child index would otherwise make pagesTotal undrainable) and
  // make pagesTotal authoritative. Also repairs a corrupt non-null
  // discoveredUrls (re-discovered above): re-store the clean set so every
  // future attempt fans out the same list. Deterministic across attempts
  // because the stored set is.
  urls = [...new Set(urls)]
  const ensured = await prisma.siteAudit.updateMany({
    where: { id: siteAuditId, status: 'running' },
    data: { discoveredUrls: JSON.stringify(urls), pagesTotal: urls.length },
  })
  if (ensured.count === 0) {
    // Parent is no longer running (cancelled/failed/completed under a stale
    // attempt) — do NOT create children or enqueue work for a dead parent.
    kickPromoter()
    return
  }

  // Create missing children. Per-row create with P2002 skip — idempotent
  // under any zombie/retry interleaving thanks to @@unique([siteAuditId, url]).
  const existing = await prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: { id: true, url: true, status: true },
  })
  const byUrl = new Map(existing.map((c) => [c.url, c]))
  for (const url of urls) {
    if (byUrl.has(url)) continue
    try {
      const child = await prisma.adaAudit.create({
        data: {
          url,
          status: 'pending',
          clientId: audit.clientId,
          siteAuditId,
          wcagLevel: audit.wcagLevel,
        },
        select: { id: true, url: true, status: true },
      })
      byUrl.set(url, child)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await prisma.adaAudit.findFirst({
          where: { siteAuditId, url },
          select: { id: true, url: true, status: true },
        })
        if (dup) byUrl.set(url, dup)
        continue
      }
      throw e
    }
  }

  // Fan out one page job per unsettled child. Active-window dedup absorbs
  // re-runs; a duplicate job against a settled child no-ops via the child
  // claim. A failed enqueue settles its child NOW (mirrors the PSI/PDF
  // enqueue-failure fallback) — a child with no job would strand the audit.
  for (const url of urls) {
    const child = byUrl.get(url)
    if (!child || (child.status !== 'pending' && child.status !== 'running')) continue
    const pageJob: SiteAuditPageJob = {
      adaAuditId: child.id,
      siteAuditId,
      url,
      wcagLevel: audit.wcagLevel,
    }
    try {
      await enqueueJob({
        type: SITE_AUDIT_PAGE_JOB_TYPE,
        payload: pageJob,
        dedupKey: `page:${siteAuditId}:${url}`,
        groupKey: `site-audit:${siteAuditId}`,
      })
    } catch (err) {
      console.error('[jobs/site-audit-discover] page enqueue failed for', url, ':', (err as Error).message)
      try {
        await settlePageFailure(pageJob, `Failed to enqueue durable page job: ${(err as Error).message}`)
      } catch (settleErr) {
        console.error('[jobs/site-audit-discover] enqueue-failure settle also failed for', url, ':', (settleErr as Error).message)
      }
    }
  }

  if (urls.length === 0) {
    try {
      await finalizeSiteAudit(siteAuditId)
    } catch (err) {
      console.warn('[jobs/site-audit-discover] finalize of empty audit failed:', (err as Error).message)
    }
  }
}

export async function onSiteAuditDiscoverExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  const { siteAuditId } = assertDiscoverPayload(payload)
  const { failSiteAudit } = await import('@/lib/ada-audit/queue-manager')
  await failSiteAudit(siteAuditId, `Site audit discovery failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerSiteAuditDiscoverHandler(): void {
  registerJobHandler({
    type: SITE_AUDIT_DISCOVER_JOB_TYPE,
    concurrency: 1, // never a reason to run two discovers
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 300_000, // 1000-page sitemap discovery + ~2000 inserts fits
    handler: runSiteAuditDiscoverJob,
    onExhausted: onSiteAuditDiscoverExhausted,
  })
}
