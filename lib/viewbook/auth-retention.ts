import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const GRANT_HISTORY_TTL_MS = 7 * DAY_MS
const REVOKED_SESSION_HISTORY_TTL_MS = 7 * DAY_MS
const AUTH_REQUEST_TTL_MS = 48 * HOUR_MS

export async function pruneViewbookAuthRows(now = new Date()): Promise<{
  grants: number
  sessions: number
  requests: number
}> {
  const grantHistoryCutoff = new Date(now.getTime() - GRANT_HISTORY_TTL_MS)
  const revokedSessionCutoff = new Date(now.getTime() - REVOKED_SESSION_HISTORY_TTL_MS)
  const requestCutoff = new Date(now.getTime() - AUTH_REQUEST_TTL_MS)

  // Keep these writes sequential: concurrent SQLite deleteMany calls contend
  // for the same database write lock without improving cleanup latency.
  const grants = await prisma.viewbookAuthGrant.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: grantHistoryCutoff } },
        { consumedAt: { lt: grantHistoryCutoff } },
      ],
    },
  })
  const sessions = await prisma.viewbookMemberSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: revokedSessionCutoff } },
      ],
    },
  })
  const requests = await prisma.viewbookAuthRequest.deleteMany({
    where: { createdAt: { lt: requestCutoff } },
  })

  return { grants: grants.count, sessions: sessions.count, requests: requests.count }
}
