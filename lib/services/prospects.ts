// lib/services/prospects.ts
// C14: prospect CRUD for the /sales intake. One prospect per normalized
// domain, best-effort app-level (client-schedules precedent, no DB unique).
import { prisma } from '@/lib/db'

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
  latestAudit: null | {
    id: string
    status: string
    completedAt: string | null
    adaScore: number | null
    reportable: boolean
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
      crawlRuns: { select: { tool: true, score: true } },
    },
  })
  const latestByProspect = new Map<number, (typeof audits)[number]>()
  for (const a of audits) {
    if (a.prospectId !== null && !latestByProspect.has(a.prospectId)) latestByProspect.set(a.prospectId, a)
  }
  return prospects.map((p) => {
    const a = latestByProspect.get(p.id) ?? null
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      createdAt: p.createdAt.toISOString(),
      salesTokenActive: !!p.salesToken && !!p.salesTokenExpiresAt && p.salesTokenExpiresAt > now,
      latestAudit: a
        ? {
            id: a.id,
            status: a.status,
            completedAt: a.completedAt?.toISOString() ?? null,
            adaScore: a.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null,
            reportable: a.status === 'complete' && a.crawlRuns.some((r) => r.tool === 'seo-parser'),
          }
        : null,
    }
  })
}
