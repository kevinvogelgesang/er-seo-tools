// lib/findings/ada-write.ts
//
// Fetch-map-write entries for the ADA side. writeAdaSingleFindings is the
// standalone hook target (app/api/ada-audit background runner) and the
// rebuild path; writeAdaSiteFindings is the rebuild path for site audits —
// the live finalizer hook maps from its already-loaded children instead
// (no second load) and calls writeFindingsRun directly. Callers wrap these
// in try/catch — a findings failure must never affect the legacy path.
import { prisma } from '@/lib/db'
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'
import { mapAdaChildren, mapAdaSingle } from './ada-mapper'
import { writeFindingsRun } from './writer'

export async function writeAdaSiteFindings(siteAuditId: string): Promise<void> {
  const parent = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, clientId: true, wcagLevel: true, status: true,
      pagesError: true, startedAt: true, completedAt: true, pagesTotal: true,
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
  // A2-f1 guard: a complete child with a null result blob can only mean the
  // 90-d blob prune ran (the finalizer never persists a complete child without
  // its blob). Rebuilding from null yields an empty run, and the writer's
  // delete-and-recreate would then silently clobber the canonical findings
  // tables — the record of record for pruned audits. Refuse. (Errored/redirected
  // children are legitimately blobless and are NOT the pruned signature.)
  if (children.some((c) => c.status === 'complete' && !c.result)) {
    throw new Error(`site audit ${siteAuditId}: child result blobs were pruned (90-d archive) — cannot rebuild. Findings rows are the canonical record now.`)
  }
  const weights = await resolveAdaScoringWeights()
  await writeFindingsRun(mapAdaChildren(parent, children, weights))
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
  // A2-f1 guard: mirrors the Session branch in scripts/findings-rebuild.ts. A
  // complete audit with a null result blob means the 90-d prune ran; rebuilding
  // from null produces an empty run that the writer's delete-and-recreate would
  // clobber the canonical findings with. Refuse. (A 'redirected' audit is
  // legitimately blobless — the status check above already let it through, and
  // it is not gated here.)
  if (audit.status === 'complete' && !audit.result) {
    throw new Error(`ada audit ${adaAuditId}: result blob was pruned (90-d archive) — cannot rebuild. Findings rows are the canonical record now.`)
  }
  const weights = await resolveAdaScoringWeights()
  await writeFindingsRun(mapAdaSingle(audit, weights))
}
