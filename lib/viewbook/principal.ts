import { Prisma } from '@prisma/client'
import { cookies as nextCookies } from 'next/headers'
import { AUTH_COOKIE_NAME, getAuthSession, isAuthBypassedInDev } from '@/lib/auth'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { LAST_SEEN_TOUCH_MS } from './auth-config'
import { hashSecret, memberCookieName } from './auth-secrets'

export type ViewbookPrincipal =
  | {
      kind: 'member'
      member: { id: number; memberKey: string; name: string; email: string }
      sessionId: number
    }
  | { kind: 'operator'; email: string }
  | { kind: 'dev'; email: 'dev@localhost' }
  | { kind: 'break-glass' }

export interface PublicMutationAuth {
  principal: ViewbookPrincipal
}

export async function requireMemberStillAuthorized(
  auth: PublicMutationAuth,
  viewbookId: number,
): Promise<void> {
  if (auth.principal.kind !== 'member') return
  const session = await prisma.viewbookMemberSession.findFirst({
    where: {
      id: auth.principal.sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      member: { viewbookId },
    },
    select: { id: true },
  })
  if (!session) throw new HttpError(404, 'not_found')
}

export function canRead(principal: ViewbookPrincipal | null): principal is ViewbookPrincipal {
  return principal !== null
}

export function canWrite(principal: ViewbookPrincipal | null): boolean {
  return principal?.kind === 'member' || principal?.kind === 'operator' || principal?.kind === 'dev'
}

export async function resolveViewbookPrincipalFromCookies(
  { erAuthCookie, memberCookie }: { erAuthCookie: string | null; memberCookie: string | null },
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null> {
  if (isAuthBypassedInDev()) return { kind: 'dev', email: 'dev@localhost' }

  const erSession = await getAuthSession(erAuthCookie)
  if (erSession) {
    return erSession.email
      ? { kind: 'operator', email: erSession.email }
      : { kind: 'break-glass' }
  }
  if (!memberCookie) return null

  const row = await prisma.viewbookMemberSession.findUnique({
    where: { tokenHash: hashSecret(memberCookie) },
    include: {
      member: {
        select: { id: true, memberKey: true, name: true, email: true, viewbookId: true },
      },
    },
  })
  const now = Date.now()
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now) return null
  if (row.member.viewbookId !== viewbook.id) return null

  if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > LAST_SEEN_TOUCH_MS) {
    try {
      await prisma.viewbookMemberSession.updateMany({
        where: {
          id: row.id,
          revokedAt: null,
          expiresAt: { gt: new Date(now) },
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: new Date(now - LAST_SEEN_TOUCH_MS) } },
          ],
        },
        data: { lastSeenAt: new Date(now) },
      })
    } catch (error) {
      logError({ subsystem: 'viewbook', op: 'session-touch', sessionId: row.id }, error)
    }
  }

  const { viewbookId: _viewbookId, ...member } = row.member
  void _viewbookId
  return { kind: 'member', member, sessionId: row.id }
}

function requestCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator < 0 || trimmed.slice(0, separator) !== name) continue
    try {
      return decodeURIComponent(trimmed.slice(separator + 1))
    } catch {
      return null
    }
  }
  return null
}

export async function resolveViewbookPrincipal(
  request: Request,
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null> {
  return resolveViewbookPrincipalFromCookies(
    {
      erAuthCookie: requestCookie(request, AUTH_COOKIE_NAME),
      memberCookie: requestCookie(request, memberCookieName(viewbook.id)),
    },
    viewbook,
  )
}

export async function resolveViewbookPrincipalRSC(
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null> {
  const cookieStore = await nextCookies()
  return resolveViewbookPrincipalFromCookies(
    {
      erAuthCookie: cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null,
      memberCookie: cookieStore.get(memberCookieName(viewbook.id))?.value ?? null,
    },
    viewbook,
  )
}

export async function requireCanRead(
  request: Request,
  viewbook: { id: number },
): Promise<ViewbookPrincipal> {
  const principal = await resolveViewbookPrincipal(request, viewbook)
  if (!canRead(principal)) throw new HttpError(404, 'not_found')
  return principal
}

export async function requireCanWrite(
  request: Request,
  viewbook: { id: number },
): Promise<ViewbookPrincipal> {
  const principal = await resolveViewbookPrincipal(request, viewbook)
  if (!canWrite(principal) || !principal) throw new HttpError(404, 'not_found')
  return principal
}

export function memberWriteFence(
  principal: ViewbookPrincipal,
  viewbookId: number,
  now: number,
): Prisma.Sql {
  if (principal.kind !== 'member') return Prisma.sql`1 = 1`
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookMemberSession" ms
    JOIN "ViewbookTeamMember" tm ON tm."id" = ms."memberId"
    WHERE ms."id" = ${principal.sessionId}
      AND ms."revokedAt" IS NULL
      AND ms."expiresAt" > ${now}
      AND tm."viewbookId" = ${viewbookId}
  )`
}

export function attributionOf(
  principal: ViewbookPrincipal,
): { actorEmail: string; authorName: string; actorKind: 'member' | 'operator' } {
  if (principal.kind === 'member') {
    return {
      actorEmail: principal.member.email,
      authorName: principal.member.name,
      actorKind: 'member',
    }
  }
  if (principal.kind === 'operator') {
    return { actorEmail: principal.email, authorName: principal.email, actorKind: 'operator' }
  }
  if (principal.kind === 'dev') {
    return { actorEmail: principal.email, authorName: principal.email, actorKind: 'operator' }
  }
  throw new HttpError(404, 'not_found')
}
