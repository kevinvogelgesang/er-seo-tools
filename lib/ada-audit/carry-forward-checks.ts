// lib/ada-audit/carry-forward-checks.ts
//
// C2: copy SiteAuditCheck rows from the previous completed audit of the
// same domain to a just-completed audit. Keys are content-derived sha256
// digests, so identical findings hash identically across runs — analysts
// don't re-dismiss the same finding monthly.
//
// Domain-keyed, not client-keyed (a dismissal is about the finding, not
// the client record). Keys with no matching finding in the new run are
// inert rows that die with the audit. Fire-and-forget from the finalizer:
// a failure logs and never affects the audit.

import { prisma } from '@/lib/db'

const CHUNK = 50

export async function carryForwardSiteAuditChecks(siteAuditId: string): Promise<void> {
  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: { domain: true, completedAt: true },
  })
  if (!audit?.completedAt) return

  const prev = await prisma.siteAudit.findFirst({
    where: {
      domain: audit.domain,
      status: 'complete',
      id: { not: siteAuditId },
      completedAt: { lt: audit.completedAt },
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  if (!prev) return

  const [prevChecks, existing] = await Promise.all([
    prisma.siteAuditCheck.findMany({
      where: { siteAuditId: prev.id },
      select: { scope: true, key: true, checkedBy: true },
    }),
    prisma.siteAuditCheck.findMany({
      where: { siteAuditId },
      select: { scope: true, key: true },
    }),
  ])
  const have = new Set(existing.map((c) => `${c.scope}\n${c.key}`))
  const toCopy = prevChecks.filter((c) => !have.has(`${c.scope}\n${c.key}`))
  if (toCopy.length === 0) return

  for (let i = 0; i < toCopy.length; i += CHUNK) {
    const chunk = toCopy.slice(i, i + CHUNK)
    try {
      await prisma.siteAuditCheck.createMany({
        data: chunk.map((c) => ({ siteAuditId, scope: c.scope, key: c.key, checkedBy: c.checkedBy })),
      })
    } catch {
      // SQLite createMany has no skipDuplicates; a concurrent insert of the
      // same (siteAuditId, scope, key) fails the whole chunk. Fall back to
      // row-by-row, tolerating unique-index hits.
      for (const c of chunk) {
        try {
          await prisma.siteAuditCheck.create({
            data: { siteAuditId, scope: c.scope, key: c.key, checkedBy: c.checkedBy },
          })
        } catch { /* duplicate — already present, fine */ }
      }
    }
  }
  console.log(`[checks] carried ${toCopy.length} check(s) forward from ${prev.id} to ${siteAuditId}`)
}
