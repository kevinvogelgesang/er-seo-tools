import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { publishInvalidation } from '@/lib/events/bus'
import { prospectListTopic } from '@/lib/events/topics'
import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const DELETE = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const existing = await prisma.prospect.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // C14 hero (spec Codex fix 3b + plan Codex fix 2): prospect DELETE SetNulls
  // its audits rather than deleting them — without this snapshot the hero
  // files would be permanent orphans. Snapshot ALL linked audit ids, NOT just
  // rows with a stamped homepageScreenshot: a concurrent publish may have
  // written the file but not stamped the column yet (the hero path is the
  // deterministic `<id>.png`, so deleting by id is always safe and
  // ENOENT-tolerant). Snapshot BEFORE the delete, then null the columns and
  // remove the files (best-effort) after.
  const linkedAudits = await prisma.siteAudit.findMany({
    where: { prospectId: id },
    select: { id: true },
  })

  await prisma.prospect.delete({ where: { id } }) // SiteAudit.prospectId SetNulls via relation

  if (linkedAudits.length > 0) {
    const ids = linkedAudits.map((a) => a.id)
    await prisma.siteAudit.updateMany({ where: { id: { in: ids } }, data: { homepageScreenshot: null } })
    const cleanup = await Promise.allSettled(ids.map((aid) => deleteHeroScreenshot(aid)))
    for (const r of cleanup) {
      if (r.status === 'rejected') console.warn('[sales] hero cleanup failed on prospect delete:', r.reason)
    }

    // PR3: these audits just lost prospect ownership (prospectId SetNull'd by the
    // delete above), so any still-queued discover job must drop back to the
    // non-prospect priority. A stale priority-1 job would out-claim a real
    // prospect's discover job (worker claims by [priority desc, createdAt asc]),
    // making the worker disagree with every queue-order reader (which now
    // classifies these audits as non-prospect). Demote, never cancel — the
    // orphaned audit still runs, just at normal priority.
    await prisma.job.updateMany({
      where: {
        type: 'site-audit-discover',
        status: 'queued',
        groupKey: { in: ids.map((aid) => `site-audit:${aid}`) },
        priority: { gt: 0 },
      },
      data: { priority: 0 },
    })
  }

  // A5 Task 19: a row disappeared from the /sales dashboard list. Emit AFTER
  // the delete resolved (unreached on the 404 above — nothing changed there).
  publishInvalidation(prospectListTopic())
  return NextResponse.json({ ok: true })
})
