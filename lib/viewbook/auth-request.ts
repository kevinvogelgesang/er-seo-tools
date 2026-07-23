import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import {
  AUTH_HOUR_MS,
  authCooldownMs,
  authEmailHourlyCap,
  authLedgerHourlyCap,
  authViewbookHourlyCap,
} from './auth-config'
import { enqueueViewbookEmail } from './email'

export async function requestMagicLink(
  viewbook: { id: number },
  email: string,
  now = Date.now(),
): Promise<void> {
  const requestId = crypto.randomUUID()
  const dedupKey = `vb-magic-request:${requestId}`
  const hourStart = now - AUTH_HOUR_MS

  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO "ViewbookAuthRequest" ("id", "viewbookId", "email", "createdAt")
      SELECT ${requestId}, ${viewbook.id}, ${email}, ${now}
      WHERE NOT EXISTS (
        SELECT 1 FROM "ViewbookAuthRequest"
        WHERE "viewbookId" = ${viewbook.id}
          AND "email" = ${email}
          AND "createdAt" > ${now - authCooldownMs()}
      )
        AND (
          SELECT COUNT(*) FROM "ViewbookAuthRequest"
          WHERE "email" = ${email} AND "createdAt" > ${hourStart}
        ) < ${authEmailHourlyCap()}
        AND (
          SELECT COUNT(*) FROM "ViewbookAuthRequest"
          WHERE "viewbookId" = ${viewbook.id} AND "createdAt" > ${hourStart}
        ) < ${authLedgerHourlyCap()}
    `,
    prisma.$executeRaw`
      INSERT INTO "ViewbookEmailDelivery"
        ("viewbookId", "kind", "recipient", "dedupKey", "memberId", "stageLogId", "createdAt")
      SELECT ${viewbook.id}, 'magic-link', m."email", ${dedupKey}, m."id", NULL, ${now}
      FROM "ViewbookTeamMember" m
      WHERE m."viewbookId" = ${viewbook.id}
        AND m."email" = ${email}
        AND EXISTS (SELECT 1 FROM "ViewbookAuthRequest" r WHERE r."id" = ${requestId})
        AND (
          SELECT COUNT(*) FROM "ViewbookEmailDelivery" d
          WHERE d."viewbookId" = ${viewbook.id}
            AND d."kind" = 'magic-link'
            AND d."createdAt" > ${hourStart}
        ) < ${authViewbookHourlyCap()}
    `,
  ])

  const delivery = await prisma.viewbookEmailDelivery.findUnique({
    where: { dedupKey },
    select: { id: true },
  })
  if (delivery) {
    void enqueueViewbookEmail(delivery.id).catch((error) => {
      logError({
        subsystem: 'viewbook',
        op: 'magic-link-enqueue',
        viewbookId: viewbook.id,
        requestId,
        deliveryId: delivery.id,
      }, error)
    })
  }
}
