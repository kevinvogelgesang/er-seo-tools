// lib/services/prospects.ts
// C14: prospect CRUD for the /sales intake. One prospect per normalized
// domain, best-effort app-level (client-schedules precedent, no DB unique).
import { prisma } from '@/lib/db'
import { queuedAheadCount } from '@/lib/ada-audit/queue-order'

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function normalizeProspectDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  d = d.split('/')[0].split('?')[0].split('#')[0]
  d = d.replace(/^www\./, '').replace(/\.+$/, '')
  return d
}

/**
 * ONE home for the public sales-report URL (PR3, Codex fix 5) — the share
 * route and listProspects build from here so the two can never drift.
 * NEXT_PUBLIC_APP_URL, never request origin (house rule); the localhost
 * fallback is byte-identical to the share route's previous local copy.
 */
export function buildProspectSalesUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/sales/${token}`
}

export interface ProspectRow {
  id: number
  name: string
  domain: string
  createdAt: string
  salesTokenActive: boolean
  salesUrl: string | null            // active token only, via buildProspectSalesUrl
  latestAudit: null | {
    id: string
    status: string
    completedAt: string | null
    adaScore: number | null
    reportable: boolean
    pagesTotal: number
    pagesComplete: number
    pagesError: number
    pagesRedirected: number
    pdfsTotal: number
    pdfsComplete: number
    pdfsError: number
    pdfsSkipped: number
    lighthouseTotal: number
    lighthouseComplete: number
    lighthouseError: number
    startedAt: string | null         // Codex fix 4: NOT createdAt — queue wait excluded from the ETA
    queuePosition: number | null     // shared-ordering position for 'queued' audits; null otherwise
  }
}

export async function createProspect(input: {
  name: string
  domain: string
  notes?: string | null
  createdBy?: string | null
}): Promise<
  | { kind: 'created' | 'existing'; prospect: { id: number; name: string; domain: string } }
  | { kind: 'invalid'; reason: string }
> {
  const name = input.name.trim()
  if (!name) return { kind: 'invalid', reason: 'name required' }
  const domain = normalizeProspectDomain(input.domain)
  if (!domain || !DOMAIN_RE.test(domain)) return { kind: 'invalid', reason: 'domain invalid' }

  const existing = await prisma.prospect.findFirst({ where: { domain }, orderBy: { id: 'asc' } })
  if (existing) return { kind: 'existing', prospect: { id: existing.id, name: existing.name, domain: existing.domain } }

  const created = await prisma.prospect.create({
    data: { name, domain, notes: input.notes ?? null, createdBy: input.createdBy ?? null },
  })
  return { kind: 'created', prospect: { id: created.id, name: created.name, domain: created.domain } }
}

export async function listProspects(): Promise<ProspectRow[]> {
  const now = new Date()
  const prospects = await prisma.prospect.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, domain: true, createdAt: true, salesToken: true, salesTokenExpiresAt: true },
  })
  const audits = await prisma.siteAudit.findMany({
    where: { prospectId: { in: prospects.map((p) => p.id) } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, prospectId: true, status: true, completedAt: true,
      // PR3 progress + ETA scalars (spec §1). startedAt NOT createdAt — the
      // ETA must exclude queue wait (Codex fix 4). createdAt is selected for
      // the queue-position key, not surfaced.
      createdAt: true, startedAt: true,
      pagesTotal: true, pagesComplete: true, pagesError: true, pagesRedirected: true,
      pdfsTotal: true, pdfsComplete: true, pdfsError: true, pdfsSkipped: true,
      lighthouseTotal: true, lighthouseComplete: true, lighthouseError: true,
      crawlRuns: { select: { tool: true, score: true } },
    },
  })
  const latestByProspect = new Map<number, (typeof audits)[number]>()
  for (const a of audits) {
    if (a.prospectId !== null && !latestByProspect.has(a.prospectId)) latestByProspect.set(a.prospectId, a)
  }
  // PR3: shared-ordering queue position for queued latest audits (one indexed
  // count per queued row — rare: at most a handful of prospects queue at once).
  const queuePositions = new Map<string, number>()
  for (const a of latestByProspect.values()) {
    if (a.status === 'queued') {
      queuePositions.set(a.id, (await queuedAheadCount(a)) + 1)
    }
  }
  return prospects.map((p) => {
    const a = latestByProspect.get(p.id) ?? null
    const tokenActive = !!p.salesToken && !!p.salesTokenExpiresAt && p.salesTokenExpiresAt > now
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      createdAt: p.createdAt.toISOString(),
      salesTokenActive: tokenActive,
      salesUrl: tokenActive && p.salesToken ? buildProspectSalesUrl(p.salesToken) : null,
      latestAudit: a
        ? {
            id: a.id,
            status: a.status,
            completedAt: a.completedAt?.toISOString() ?? null,
            adaScore: a.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null,
            reportable: a.status === 'complete' && a.crawlRuns.some((r) => r.tool === 'seo-parser'),
            pagesTotal: a.pagesTotal,
            pagesComplete: a.pagesComplete,
            pagesError: a.pagesError,
            pagesRedirected: a.pagesRedirected,
            pdfsTotal: a.pdfsTotal,
            pdfsComplete: a.pdfsComplete,
            pdfsError: a.pdfsError,
            pdfsSkipped: a.pdfsSkipped,
            lighthouseTotal: a.lighthouseTotal,
            lighthouseComplete: a.lighthouseComplete,
            lighthouseError: a.lighthouseError,
            startedAt: a.startedAt?.toISOString() ?? null,
            queuePosition: queuePositions.get(a.id) ?? null,
          }
        : null,
    }
  })
}
