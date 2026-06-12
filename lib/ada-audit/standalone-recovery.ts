// lib/ada-audit/standalone-recovery.ts
//
// Recovery for standalone (siteAuditId = null) ADA audits and their PDF
// rows. AdaAudit/PdfAudit have no updatedAt — durable-job state is the
// liveness source of truth: active jobs include queued-in-backoff rows, so
// any legitimately in-flight audit has ≥1 active job in its ada-audit:<id>
// group. The createdAt threshold only guards the seconds-wide
// create→enqueue races (POST route; PDF insert→enqueue).
//
// Conservative by design (same rule as recoverOrFailTransient): a job-count
// read error skips the row this pass — a transient read error must never
// bias toward the destructive path — and any live job in the group defers
// PDF flips to a later pass. The sweep runs every 10 min.

import { prisma } from '@/lib/db'
import { countActiveJobsByGroup } from '@/lib/jobs/queue'

const RACE_GUARD_MS = 5 * 60 * 1000

async function activeJobsOrNull(groupKey: string, label: string): Promise<number | null> {
  try {
    return await countActiveJobsByGroup(groupKey)
  } catch (err) {
    console.warn(`[ada-recovery] job count failed for ${label}, skipping this pass:`, (err as Error).message)
    return null
  }
}

export async function recoverStandaloneAudits(now: Date = new Date()): Promise<void> {
  const threshold = new Date(now.getTime() - RACE_GUARD_MS)

  const audits = await prisma.adaAudit.findMany({
    where: {
      siteAuditId: null,
      status: { in: ['pending', 'running'] },
      createdAt: { lt: threshold },
    },
    select: { id: true },
  })
  for (const a of audits) {
    const active = await activeJobsOrNull(`ada-audit:${a.id}`, a.id)
    if (active === null || active > 0) continue
    console.warn(`[ada-recovery] failing orphaned standalone audit ${a.id}`)
    await prisma.adaAudit.updateMany({
      where: { id: a.id, status: { in: ['pending', 'running'] } },
      data: {
        status: 'error',
        error: 'Audit interrupted (server restarted or job lost)',
        completedAt: new Date(),
      },
    })
  }

  // Standalone-attached PDF rows whose pdf-scan job was lost (crash between
  // row insert and enqueue). Group-level liveness check per parent audit.
  const pdfs = await prisma.pdfAudit.findMany({
    where: {
      siteAuditId: null,
      adaAuditId: { not: null },
      status: { in: ['pending', 'scanning'] },
      createdAt: { lt: threshold },
    },
    select: { id: true, adaAuditId: true },
  })
  const byAudit = new Map<string, string[]>()
  for (const p of pdfs) {
    const key = p.adaAuditId as string
    byAudit.set(key, [...(byAudit.get(key) ?? []), p.id])
  }
  for (const [adaAuditId, ids] of byAudit) {
    const active = await activeJobsOrNull(`ada-audit:${adaAuditId}`, `pdf group ${adaAuditId}`)
    if (active === null || active > 0) continue
    console.warn(`[ada-recovery] failing ${ids.length} orphaned standalone PDF row(s) for audit ${adaAuditId}`)
    await prisma.pdfAudit.updateMany({
      where: { id: { in: ids }, status: { in: ['pending', 'scanning'] } },
      data: { status: 'error', scanError: 'PDF scan interrupted (server restarted or job lost)' },
    })
  }
}
