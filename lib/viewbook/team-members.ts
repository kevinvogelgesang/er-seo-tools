// Team-member invite core (v2 PR5 spec §8): add + resend, both commit-time
// fenced with SQL-enforced caps (never count-then-create). `memberKey` is an
// app-generated UUID minted BEFORE the txn — array-form transactions cannot
// consume a prior statement's autoincrement id, and the delivery dedupKey
// (`vb-invite:<memberKey>:<n>`) needs it in the SAME transaction that creates
// the member.
//
// Add is member-AND-invite atomic (Codex fix 5): the 24h invite-window cap
// rides the SAME predicate `A` that gates the member INSERT, so a capped-out
// request creates NEITHER row — no orphan member without an invite. The
// delivery INSERT uses a SEPARATE predicate `A2` (Codex fix 4): after the
// member INSERT runs, `A`'s `NOT EXISTS(clientMutationId replay)` clause is
// FALSE within the same txn (the row now exists), so reusing `A` would block
// the very delivery the member insert just earned. `A2` = "the member this
// txn just created exists" (by memberKey) AND the same window cap,
// re-evaluated after the member row lands.
//
// Resend has NO durable idempotency (Codex fix 6): ViewbookEmailDelivery has
// no clientMutationId column and PR5 adds no migration, so a resend cannot be
// made HTTP-replay-safe. A double-submit that both pass the <3-sends gate is
// accepted — bounded by the cap + the per-token write throttle + the 24h
// window cap. The ordinal (`n = existing-sends-for-member + 1`) and the
// resulting dedupKey are computed IN SQL so two concurrent resends can never
// race onto the same ordinal; SQLite's single-writer serialization means at
// most one of two racing resends succeeds when the cap is exactly hit.
//
// Both the member INSERT and both delivery INSERTs use `RETURNING "id"` via
// `$queryRaw` (the `ViewbookField` POST route precedent) so the exact row
// created inside the fenced transaction is known without a post-commit
// guess — essential for resend, whose dedupKey ordinal isn't known in JS
// until the guarded SQL has run.

import crypto from 'crypto'
import { Prisma, type Viewbook, type ViewbookTeamMember } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { requireViewbookToken } from './route-auth'
import { validateClientMutationId } from './public-write-guard'
import { canonicalMailbox } from './global-content-keys'
import { syncVersionBumpWhere } from './sync'
import { enqueueViewbookEmail } from './email'

const MEMBER_CAP = 15
const RESEND_CAP = 3
const INVITE_WINDOW_MS = 24 * 60 * 60 * 1000
const INVITE_WINDOW_CAP = 10
const NAME_MAX_BYTES = 120

export interface MutationHooks {
  beforeCommit?: () => Promise<void>
}

export interface AddTeamMemberInput {
  name: string
  email: string
  clientMutationId: string
}

export interface AddTeamMemberResult {
  member: ViewbookTeamMember
  replayed: boolean
  delivered: boolean
}

export interface ResendInviteInput {
  memberId: number
}

export interface ResendInviteResult {
  delivered: boolean
}

function validateName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_name')
  const name = raw.trim()
  if (!name || Buffer.byteLength(name, 'utf8') > NAME_MAX_BYTES) throw new HttpError(400, 'invalid_name')
  return name
}

// The pc-invite section gates BOTH the member insert and the resend — a
// hidden section must block the invite email exactly like public-writes.ts
// blocks feedback/materials on a hidden section (Global Constraints route
// contract: token current + revoked + client active + section visible +
// ownership + caps). JOIN (not EXISTS) mirrors this file's existing style.
function accessChainPredicate(viewbookId: number, token: string): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1 FROM "Viewbook" v
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'pc-invite' AND s."state" <> 'hidden'
      WHERE v."id" = ${viewbookId} AND v."token" = ${token} AND v."revokedAt" IS NULL AND c."archivedAt" IS NULL
    )
  `
}

// Hidden-section diagnosis (mirrors ack.ts's `!section || section.state ===
// 'hidden'` check): a hidden pc-invite section must 404 as `not_found` — the
// SAME oracle as a missing/revoked viewbook — BEFORE any cap/dup/window
// check runs, so a hidden section never leaks distinguishing information
// through a 409/429 instead.
async function requirePcInviteSectionVisible(viewbookId: number): Promise<void> {
  const section = await prisma.viewbookSection.findFirst({
    where: { viewbookId, sectionKey: 'pc-invite' },
  })
  if (!section || section.state === 'hidden') throw new HttpError(404, 'not_found')
}

function inviteWindowCapPredicate(viewbookId: number, windowStart: number): Prisma.Sql {
  return Prisma.sql`
    (SELECT COUNT(*) FROM "ViewbookEmailDelivery"
     WHERE "viewbookId" = ${viewbookId} AND "kind" = 'team-invite' AND "createdAt" >= ${windowStart}) < ${INVITE_WINDOW_CAP}
  `
}

// ── Add ──────────────────────────────────────────────────────────────────

export async function addTeamMember(
  viewbook: Viewbook,
  token: string,
  input: AddTeamMemberInput,
  hooks: MutationHooks = {},
): Promise<AddTeamMemberResult> {
  const name = validateName(input.name)
  const email = canonicalMailbox(input.email)
  if (!email) throw new HttpError(400, 'invalid_email')
  const clientMutationId = validateClientMutationId(input.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')

  await hooks.beforeCommit?.()
  const now = Date.now()
  const memberKey = crypto.randomUUID()
  const windowStart = now - INVITE_WINDOW_MS
  const summary = `Invited team member: ${name}`

  const windowCap = inviteWindowCapPredicate(viewbook.id, windowStart)
  // Self-contained (Codex fix 5 — atomic add): the 24h invite-window cap
  // rides the SAME predicate that gates the member INSERT, so a capped-out
  // request creates neither row.
  const A = Prisma.sql`
    ${accessChainPredicate(viewbook.id, token)}
    AND NOT EXISTS (SELECT 1 FROM "ViewbookTeamMember" WHERE "clientMutationId" = ${clientMutationId})
    AND (SELECT COUNT(*) FROM "ViewbookTeamMember" WHERE "viewbookId" = ${viewbook.id}) < ${MEMBER_CAP}
    AND NOT EXISTS (SELECT 1 FROM "ViewbookTeamMember" WHERE "viewbookId" = ${viewbook.id} AND "email" = ${email})
    AND ${windowCap}
  `
  // NOT `A` (Codex fix 4): after the member INSERT runs, A's replay clause is
  // false (the row now exists) — reusing A would block the delivery this add
  // just earned. A2 ties the delivery to the member THIS txn created and
  // re-checks the same window cap.
  const A2 = Prisma.sql`
    EXISTS (SELECT 1 FROM "ViewbookTeamMember" WHERE "viewbookId" = ${viewbook.id} AND "memberKey" = ${memberKey})
    AND ${windowCap}
  `

  const [, activityCount, memberRows, deliveryRows] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, A),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${viewbook.id}, 'team-invite-add', 'client', ${summary}, ${now}
      WHERE (${A})
    `,
    prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "ViewbookTeamMember"
        ("viewbookId", "memberKey", "name", "email", "addedBy", "clientMutationId", "createdAt")
      SELECT ${viewbook.id}, ${memberKey}, ${name}, ${email}, 'client', ${clientMutationId}, ${now}
      WHERE (${A})
      ON CONFLICT("clientMutationId") DO NOTHING
      RETURNING "id"
    `,
    prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "ViewbookEmailDelivery"
        ("viewbookId", "kind", "recipient", "dedupKey", "memberId", "stageLogId", "createdAt")
      SELECT ${viewbook.id}, 'team-invite', ${email}, ${`vb-invite:${memberKey}:1`}, NULL, NULL, ${now}
      WHERE (${A2})
      ON CONFLICT("dedupKey") DO NOTHING
      RETURNING "id"
    `,
  ])

  if (memberRows.length === 1) {
    if (activityCount !== 1) throw new Error('viewbook_team_add_activity_mismatch')
    if (deliveryRows.length !== 1) throw new Error('viewbook_team_add_delivery_mismatch')
    const member = await prisma.viewbookTeamMember.findUniqueOrThrow({ where: { id: memberRows[0].id } })
    const deliveryId = deliveryRows[0].id
    void enqueueViewbookEmail(deliveryId).catch((err) => {
      logError({ subsystem: 'viewbook', op: 'team-invite-add-enqueue', viewbookId: viewbook.id }, err)
    })
    return { member, replayed: false, delivered: true }
  }

  // Replay / blocked diagnosis (member count 0). The replay lookup must
  // recheck pc-invite section visibility (Codex fix — replay-vs-fresh
  // oracle): without it, replaying an add after an operator hides pc-invite
  // would return 200 (the stale member row) while a fresh add/resend on the
  // same viewbook 404s — an inconsistent oracle. Mirrors the same
  // `sections: { some: { sectionKey, state: { not: 'hidden' } } }` shape used
  // elsewhere in this file's access chains.
  const replay = await prisma.viewbookTeamMember.findFirst({
    where: {
      clientMutationId, viewbookId: viewbook.id,
      viewbook: {
        token, revokedAt: null, client: { archivedAt: null },
        sections: { some: { sectionKey: 'pc-invite', state: { not: 'hidden' } } },
      },
    },
  })
  if (replay) return { member: replay, replayed: true, delivered: true }

  await requireViewbookToken(token)
  await requirePcInviteSectionVisible(viewbook.id)
  const memberTotal = await prisma.viewbookTeamMember.count({ where: { viewbookId: viewbook.id } })
  if (memberTotal >= MEMBER_CAP) throw new HttpError(409, 'team_member_limit_reached')
  const dup = await prisma.viewbookTeamMember.findFirst({ where: { viewbookId: viewbook.id, email } })
  if (dup) throw new HttpError(409, 'duplicate_email')
  const windowCount = await prisma.viewbookEmailDelivery.count({
    where: { viewbookId: viewbook.id, kind: 'team-invite', createdAt: { gte: new Date(windowStart) } },
  })
  if (windowCount >= INVITE_WINDOW_CAP) throw new HttpError(429, 'invite_limit_reached')
  throw new HttpError(404, 'not_found')
}

// ── Resend ───────────────────────────────────────────────────────────────

export async function resendInvite(
  viewbook: Viewbook,
  token: string,
  input: ResendInviteInput,
  hooks: MutationHooks = {},
): Promise<ResendInviteResult> {
  const memberId = input.memberId
  if (!Number.isInteger(memberId) || memberId <= 0) throw new HttpError(404, 'not_found')

  await hooks.beforeCommit?.()

  // Pre-read is identity resolution only (memberKey/email needed to build the
  // LIKE prefix + dedupKey) — NOT the fence. The guarded INSERT below
  // re-verifies the full access chain + caps at commit time.
  const existing = await prisma.viewbookTeamMember.findFirst({
    where: { id: memberId, viewbookId: viewbook.id },
    select: { memberKey: true, email: true },
  })
  if (!existing) {
    await requireViewbookToken(token)
    throw new HttpError(404, 'not_found')
  }
  const { memberKey, email } = existing
  const now = Date.now()
  const windowStart = now - INVITE_WINDOW_MS
  const likePrefix = `vb-invite:${memberKey}:`

  const accessChain = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "ViewbookTeamMember" tm
      JOIN "Viewbook" v ON v."id" = tm."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = 'pc-invite' AND s."state" <> 'hidden'
      WHERE tm."id" = ${memberId} AND tm."viewbookId" = ${viewbook.id}
        AND v."token" = ${token} AND v."revokedAt" IS NULL AND c."archivedAt" IS NULL
    )
  `
  const sendCountExpr = Prisma.sql`
    (SELECT COUNT(*) FROM "ViewbookEmailDelivery"
     WHERE "viewbookId" = ${viewbook.id} AND "dedupKey" LIKE ${`${likePrefix}%`})
  `
  const R = Prisma.sql`
    ${accessChain}
    AND ${sendCountExpr} < ${RESEND_CAP}
    AND ${inviteWindowCapPredicate(viewbook.id, windowStart)}
  `

  const [, deliveryRows] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, R),
    prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "ViewbookEmailDelivery"
        ("viewbookId", "kind", "recipient", "dedupKey", "memberId", "stageLogId", "createdAt")
      SELECT ${viewbook.id}, 'team-invite', ${email},
        ${likePrefix} || CAST((${sendCountExpr} + 1) AS TEXT), NULL, NULL, ${now}
      WHERE (${R})
      ON CONFLICT("dedupKey") DO NOTHING
      RETURNING "id"
    `,
  ])

  if (deliveryRows.length === 1) {
    const deliveryId = deliveryRows[0].id
    void enqueueViewbookEmail(deliveryId).catch((err) => {
      logError({ subsystem: 'viewbook', op: 'team-invite-resend-enqueue', viewbookId: viewbook.id }, err)
    })
    return { delivered: true }
  }

  // Blocked diagnosis.
  await requireViewbookToken(token)
  await requirePcInviteSectionVisible(viewbook.id)
  const sendCount = await prisma.viewbookEmailDelivery.count({
    where: { viewbookId: viewbook.id, dedupKey: { startsWith: likePrefix } },
  })
  if (sendCount >= RESEND_CAP) throw new HttpError(409, 'resend_limit_reached')
  const windowCount = await prisma.viewbookEmailDelivery.count({
    where: { viewbookId: viewbook.id, kind: 'team-invite', createdAt: { gte: new Date(windowStart) } },
  })
  if (windowCount >= INVITE_WINDOW_CAP) throw new HttpError(429, 'invite_limit_reached')
  throw new HttpError(404, 'not_found')
}
