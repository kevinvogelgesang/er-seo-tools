// lib/findings/ada-write.ts
//
// Fetch-map-write entries for the ADA side. writeAdaSingleFindings is the
// standalone hook target (app/api/ada-audit background runner) and the
// rebuild path; writeAdaSiteFindings is the rebuild path for site audits —
// the live finalizer hook maps from its already-loaded children instead
// (no second load) and calls writeFindingsRun directly. Callers wrap these
// in try/catch — a findings failure must never affect the legacy path.
import { prisma } from '@/lib/db'
import { mapAdaChildren, mapAdaSingle } from './ada-mapper'
import { writeFindingsRun } from './writer'

export async function writeAdaSiteFindings(siteAuditId: string): Promise<void> {
  const parent = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, clientId: true, wcagLevel: true, status: true,
      pagesError: true, startedAt: true, completedAt: true,
    },
  })
  if (!parent) throw new Error(`site audit ${siteAuditId} not found`)
  if (parent.status !== 'complete') {
    throw new Error(`site audit ${siteAuditId} is not complete (status: ${parent.status})`)
  }
  const children = await prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: { id: true, url: true, status: true, error: true, finalUrl: true, result: true },
    // Deterministic order: keep-first URL dedupe in the mapper must keep the
    // SAME child here, in the finalizer, and in compareAdaParity.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  await writeFindingsRun(mapAdaChildren(parent, children))
}

export async function writeAdaSingleFindings(adaAuditId: string): Promise<void> {
  const audit = await prisma.adaAudit.findUnique({
    where: { id: adaAuditId },
    select: {
      id: true, url: true, status: true, result: true, finalUrl: true,
      wcagLevel: true, clientId: true, siteAuditId: true,
      startedAt: true, completedAt: true,
    },
  })
  if (!audit) throw new Error(`ada audit ${adaAuditId} not found`)
  if (audit.siteAuditId) {
    throw new Error(`ada audit ${adaAuditId} is a site-audit child — rebuild its parent site audit instead`)
  }
  if (audit.status !== 'complete' && audit.status !== 'redirected') {
    throw new Error(`ada audit ${adaAuditId} is not complete/redirected (status: ${audit.status})`)
  }
  await writeFindingsRun(mapAdaSingle(audit))
}
