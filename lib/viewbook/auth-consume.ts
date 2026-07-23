import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { SESSION_TTL_MS } from './auth-config'
import { hashSecret, mintSecret } from './auth-secrets'

export async function consumeGrant(
  viewbook: { id: number },
  rawGrant: string,
  now = Date.now(),
): Promise<{ rawSession: string } | null> {
  const grantHash = hashSecret(rawGrant)
  const { raw: rawSession, hash: sessionHash } = mintSecret()
  const [inserted, consumed] = await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO "ViewbookMemberSession" ("memberId", "tokenHash", "expiresAt", "createdAt")
      SELECT g."memberId", ${sessionHash}, ${now + SESSION_TTL_MS}, ${now}
      FROM "ViewbookAuthGrant" g
      JOIN "ViewbookTeamMember" m ON m."id" = g."memberId"
      WHERE g."tokenHash" = ${grantHash}
        AND g."consumedAt" IS NULL
        AND g."expiresAt" > ${now}
        AND m."viewbookId" = ${viewbook.id}
    `,
    prisma.$executeRaw`
      UPDATE "ViewbookAuthGrant"
      SET "consumedAt" = ${now}
      WHERE "tokenHash" = ${grantHash}
        AND "consumedAt" IS NULL
        AND "expiresAt" > ${now}
        AND EXISTS (
          SELECT 1 FROM "ViewbookTeamMember" m
          WHERE m."id" = "ViewbookAuthGrant"."memberId"
            AND m."viewbookId" = ${viewbook.id}
        )
    `,
  ])

  if (inserted === 1 && consumed === 1) return { rawSession }
  if (inserted !== 0 || consumed !== 0) {
    logError(
      { subsystem: 'viewbook', op: 'grant-consume-count-mismatch', viewbookId: viewbook.id, inserted, consumed },
      new Error('viewbook grant consume statements disagreed'),
    )
    if (inserted === 1 && consumed === 0) {
      await prisma.viewbookMemberSession.deleteMany({ where: { tokenHash: sessionHash } })
    }
  }
  return null
}

export async function revokeSessionByCookie(rawSession: string, now = Date.now()): Promise<void> {
  await prisma.viewbookMemberSession.updateMany({
    where: { tokenHash: hashSecret(rawSession), revokedAt: null },
    data: { revokedAt: new Date(now) },
  })
}
