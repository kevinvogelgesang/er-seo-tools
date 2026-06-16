// lib/jobs/handlers/broken-link-verify.ts
//
// Out-of-band broken-link/resource verifier (C6 Phase 1). Enqueued AFTER a
// SiteAudit reaches terminal 'complete' (see finalizeSiteAudit) — that
// post-terminal invariant is what makes reusing the site-audit:<id> group
// safe: finalizeSiteAudit early-returns on 'complete', so a pending verifier
// can never trip liveness recovery (which only resumes/fails NON-terminal
// parents). report-render avoids this group on purpose; the verifier wants the
// audit family for cancel-on-delete and is only allowed in because it runs
// post-terminal.
//
// Idempotent: re-reads HarvestedLink, the writer's delete-and-recreate on
// { siteAuditId, tool:'seo-parser' } replaces any prior run, and harvest rows
// are deleted only AFTER the run is written (crash-before-write -> rows linger
// -> retry redoes it; crash-after-write-before-delete -> rows linger -> the
// retention sweep cleans them and a retry's writeFindingsRun is a no-op replace).
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { mapBrokenLinks, type BrokenTarget } from '@/lib/findings/broken-link-mapper'
import { checkUrl, HostThrottle, realDeps, type CheckResult } from '@/lib/ada-audit/broken-link-check'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import type { JobExhaustedContext } from '../types'

export const BROKEN_LINK_VERIFY_JOB_TYPE = 'broken-link-verify'
const MAX_CHECKS = () => parsePositiveInt(process.env.BROKEN_LINK_MAX_CHECKS, 2000)
const HOST_DELAY = () => parsePositiveInt(process.env.BROKEN_LINK_HOST_DELAY_MS, 250)
const CONCURRENCY = () => parsePositiveInt(process.env.BROKEN_LINK_CONCURRENCY, 4)
const URLS_PER_FINDING = 25

export interface BrokenLinkVerifyJob {
  siteAuditId: string
  domain: string | null
}

export interface VerifyDeps {
  checkUrl: (url: string) => Promise<CheckResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const productionDeps: VerifyDeps = {
  checkUrl: (url) => checkUrl(url, realDeps),
  now: realDeps.now,
  sleep: realDeps.sleep,
}

function assertPayload(p: unknown): BrokenLinkVerifyJob {
  const j = p as Partial<BrokenLinkVerifyJob> | null
  if (!j || typeof j.siteAuditId !== 'string') throw new Error('Invalid broken-link-verify payload')
  return { siteAuditId: j.siteAuditId, domain: typeof j.domain === 'string' ? j.domain : null }
}

export async function runBrokenLinkVerify(payload: unknown, deps: VerifyDeps = productionDeps): Promise<void> {
  const job = assertPayload(payload)
  const site = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId },
    select: { id: true, domain: true, clientId: true },
  })
  if (!site) return // deleted audit -> no-op

  const rows = await prisma.harvestedLink.findMany({
    where: { siteAuditId: job.siteAuditId, kind: { in: ['internal-link', 'image'] } },
    // Deterministic order so the cap below selects a STABLE subset across retries.
    orderBy: [{ targetUrl: 'asc' }, { kind: 'asc' }, { sourcePageUrl: 'asc' }],
    select: { targetUrl: true, kind: true, sourcePageUrl: true, harvestTruncated: true },
  })
  const harvestTruncated = rows.some((r) => r.harvestTruncated)

  // Dedupe to unique (targetUrl, kind); collect a source-page sample per target.
  const startedAt = new Date(deps.now())
  const byTarget = new Map<string, { kind: 'internal-link' | 'image'; sources: Set<string> }>()
  for (const r of rows) {
    const key = `${r.kind} ${r.targetUrl}`
    let e = byTarget.get(key)
    if (!e) {
      e = { kind: r.kind as 'internal-link' | 'image', sources: new Set() }
      byTarget.set(key, e)
    }
    if (e.sources.size < URLS_PER_FINDING) e.sources.add(normalizeFindingUrl(r.sourcePageUrl))
  }
  const unique = [...byTarget.entries()].map(([key, v]) => ({
    targetUrl: key.slice(key.indexOf(' ') + 1),
    ...v,
  }))

  const cap = MAX_CHECKS()
  const capped = unique.length > cap
  if (capped) console.warn(`[broken-link-verify] ${job.siteAuditId}: capping ${unique.length} -> ${cap} checks`)
  const toCheck = capped ? unique.slice(0, cap) : unique

  // Bounded concurrency: CONCURRENCY workers pull from a shared cursor, each
  // respecting the shared per-host throttle. Single-threaded JS makes the
  // shared cursor/counter mutations safe between awaits.
  const throttle = new HostThrottle(HOST_DELAY(), deps)
  let checked = 0
  let unconfirmed = 0
  let cursor = 0
  const broken: BrokenTarget[] = []
  const worker = async (): Promise<void> => {
    while (cursor < toCheck.length) {
      const t = toCheck[cursor++]
      let host = ''
      try {
        host = new URL(t.targetUrl).hostname
      } catch {
        unconfirmed++
        continue
      }
      await throttle.wait(host)
      const res = await deps.checkUrl(t.targetUrl)
      checked++
      if (res === 'broken') broken.push({ targetUrl: t.targetUrl, kind: t.kind, sourcePageUrls: [...t.sources] })
      else if (res === 'unconfirmed') unconfirmed++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), toCheck.length || 1) }, () => worker()))

  const bundle = mapBrokenLinks(broken, {
    siteAuditId: site.id,
    domain: site.domain ?? job.domain,
    clientId: site.clientId,
    startedAt,
    completedAt: new Date(deps.now()),
    confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
  })
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  console.log(
    `[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}`,
  )
}

/** Fire-and-forget enqueue, mirrors enqueuePsiJob. Returns the enqueue promise
 * so the recovery sweep can await it; the finalizer calls it as `void`. */
export function enqueueBrokenLinkVerify(siteAuditId: string, domain: string | null): Promise<unknown> {
  return enqueueJob({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    payload: { siteAuditId, domain },
    dedupKey: `${BROKEN_LINK_VERIFY_JOB_TYPE}:${siteAuditId}`,
    groupKey: `site-audit:${siteAuditId}`,
  }).catch((err) => {
    console.error('[broken-link-verify] enqueue failed for', siteAuditId, ':', (err as Error).message)
  })
}

export async function onBrokenLinkVerifyExhausted(_p: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerBrokenLinkVerifyHandler(): void {
  registerJobHandler({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    concurrency: 1, // one verifier across the box; per-URL parallelism is internal (CONCURRENCY workers)
    maxAttempts: 2,
    backoffBaseMs: 60_000,
    timeoutMs: 900_000, // 15 min ceiling; bounded concurrency keeps real runs well under this
    handler: (payload) => runBrokenLinkVerify(payload),
    onExhausted: onBrokenLinkVerifyExhausted,
  })
}
