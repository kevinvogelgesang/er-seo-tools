import { prisma } from '@/lib/db'
import { isNotifyEnabled, notifyAdminEmail } from '@/lib/notify/config'
import { sendEmail, type SendArgs } from '@/lib/notify/transport'
import { buildViewbookDigestEmail } from '@/lib/notify/viewbook-digest-content'

const DIGEST_ROWS = 30
const MIN_INTERVAL_MS = 60 * 60 * 1000

export interface ViewbookDigestDeps {
  send: (args: SendArgs) => Promise<void>
  now: () => Date
  beforeSend?: (viewbookId: number, highWater: number) => Promise<void>
}

const realDeps: ViewbookDigestDeps = {
  send: (args) => sendEmail(args),
  now: () => new Date(),
}

interface HighWaterRow { highWater: bigint | number | null; total: bigint | number }

function activityUrl(viewbookId: number): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}/viewbooks/${viewbookId}?tab=activity` : null
}

export async function processViewbookDigest(
  viewbookId: number,
  deps: ViewbookDigestDeps = realDeps,
): Promise<void> {
  const viewbook = await prisma.viewbook.findUnique({
    where: { id: viewbookId },
    select: { id: true, digestCursorId: true, digestSentAt: true, notifyEmail: true, client: { select: { name: true } } },
  })
  if (!viewbook) return
  if (viewbook.digestSentAt && viewbook.digestSentAt.getTime() > deps.now().getTime() - MIN_INTERVAL_MS) return

  // Capture MAX exactly once. The count belongs to the same immutable range
  // and makes the overflow line honest even though only 30 rows are loaded.
  const [range] = await prisma.$queryRaw<HighWaterRow[]>`
    SELECT MAX("id") AS "highWater", COUNT(*) AS "total"
    FROM "ViewbookActivity"
    WHERE "viewbookId" = ${viewbook.id} AND "actor" = 'client' AND "id" > ${viewbook.digestCursorId}
  `
  if (!range?.highWater) return
  const highWater = Number(range.highWater)
  const total = Number(range.total)
  const items = await prisma.viewbookActivity.findMany({
    where: { viewbookId: viewbook.id, actor: 'client', id: { gt: viewbook.digestCursorId, lte: highWater } },
    orderBy: { id: 'asc' },
    take: DIGEST_ROWS,
  })

  if (!isNotifyEnabled()) {
    await prisma.viewbook.updateMany({
      where: { id: viewbook.id, digestCursorId: viewbook.digestCursorId },
      data: { digestCursorId: highWater },
    })
    return
  }

  await deps.beforeSend?.(viewbook.id, highWater)
  await deps.send({
    to: viewbook.notifyEmail ?? notifyAdminEmail(),
    content: buildViewbookDigestEmail({
      clientName: viewbook.client.name,
      items,
      overflowCount: Math.max(0, total - items.length),
      activityUrl: activityUrl(viewbook.id),
    }),
  })
  await prisma.viewbook.updateMany({
    where: { id: viewbook.id, digestCursorId: viewbook.digestCursorId },
    data: { digestCursorId: highWater, digestSentAt: deps.now() },
  })
}

export async function runViewbookDigests(deps: ViewbookDigestDeps = realDeps): Promise<void> {
  const cutoff = deps.now().getTime() - MIN_INTERVAL_MS
  const candidates = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT v."id"
    FROM "Viewbook" v
    WHERE (v."digestSentAt" IS NULL OR v."digestSentAt" < ${cutoff})
      AND EXISTS (
        SELECT 1 FROM "ViewbookActivity" a
        WHERE a."viewbookId" = v."id" AND a."actor" = 'client' AND a."id" > v."digestCursorId"
      )
    ORDER BY v."id" ASC
  `
  for (const candidate of candidates) await processViewbookDigest(candidate.id, deps)
}
