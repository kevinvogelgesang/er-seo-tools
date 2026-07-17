// Section acknowledgment + post-contract completion core (v2 PR5 spec §4).
//
// Three sections are client-ackable in the post-contract stage: pc-setup,
// pc-invite, data-source. The ack write is commit-time fenced (token
// current, not revoked, client active, section visible, not already acked —
// a self-contained EXISTS predicate `P`) exactly like the other public
// writes in this package (public-writes.ts, answers.ts). Re-acking an
// already-acked section is the idempotent no-op (0 rows, no activity, no
// bump) — there is no clientMutationId column on ViewbookSection, so
// `acknowledgedAt IS NULL` IS the replay guard.
//
// Completion: the ack that leaves every non-hidden ackable section acked
// stamps `Viewbook.pcCompletedAt` (first-writer-wins) and creates the
// `pc-complete` email delivery. `buildPcCompletion` is the ONE shared
// statement-builder for this — reused by acknowledgeSection here, the
// operator section-hide path (service.ts setSectionState), and force-advance
// (moveViewbookStage, Task 6). Statement ORDER is load-bearing: the delivery
// INSERT (gated on `pcCompletedAt IS NULL`) must run BEFORE the
// `pcCompletedAt` UPDATE in the same array, or the stamp would already be
// visible to itself and the delivery would never be created.

import { Prisma, type Viewbook, type ViewbookSection } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { requireViewbookToken } from './route-auth'
import { validateClientMutationId } from './public-write-guard'
import { syncVersionBumpWhere } from './sync'
import { enqueueViewbookEmail, pcCompleteDeliveryInsert, resolvePcCompleteRecipient } from './email'

export const ACKABLE_SECTION_KEYS = ['pc-setup', 'pc-invite', 'data-source'] as const
export type AckableSectionKey = (typeof ACKABLE_SECTION_KEYS)[number]

function isAckableSectionKey(key: string): key is AckableSectionKey {
  return (ACKABLE_SECTION_KEYS as readonly string[]).includes(key)
}

export interface MutationHooks {
  beforeCommit?: () => Promise<void>
}

export interface AcknowledgeSectionInput {
  sectionKey: string
  clientMutationId: string
}

export interface AcknowledgeSectionResult {
  acknowledged: ViewbookSection
  pcCompleted: boolean
  replayed: boolean
}

// ── Shared post-contract completion builder (Codex fix 3) ──────────────────
//
// `extraGate` narrows the base completion gate further (ack supplies "this
// section's acknowledgedAt = now" so a no-op re-ack can never trigger
// completion — Codex fix 2; the hide path omits it since hiding IS the event
// that shrinks the required set, no ack happened). Both statements share the
// SAME gate expression (self-contained, safe to reuse verbatim in two
// separate raw statements).
export interface BuildPcCompletionParams {
  viewbookId: number
  recipient: string
  now: number
  extraGate?: Prisma.Sql
}

export interface PcCompletionBuild {
  statements: [Prisma.PrismaPromise<number>, Prisma.PrismaPromise<number>]
  // Call with the pcCompletedAt-update's affected-row count (the last
  // element of the transaction's result array). No-ops unless it's 1.
  enqueueIfCompleted: (pcCompletedAtCount: number) => Promise<void>
}

export function buildPcCompletion(params: BuildPcCompletionParams): PcCompletionBuild {
  const { viewbookId, recipient, now, extraGate } = params
  const baseGate = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "Viewbook" vpc
      WHERE vpc."id" = ${viewbookId} AND vpc."stage" = 'post-contract' AND vpc."pcCompletedAt" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ViewbookSection" spc
      WHERE spc."viewbookId" = ${viewbookId}
        AND spc."sectionKey" IN (${Prisma.join([...ACKABLE_SECTION_KEYS])})
        AND spc."state" <> 'hidden' AND spc."acknowledgedAt" IS NULL
    )
  `
  const gate = extraGate ? Prisma.sql`(${baseGate}) AND (${extraGate})` : baseGate
  const deliveryInsert = pcCompleteDeliveryInsert({ viewbookId, recipient, predicate: gate })
  const pcCompletedAtUpdate = prisma.$executeRaw`
    UPDATE "Viewbook" SET "pcCompletedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${viewbookId} AND (${gate})
  `
  return {
    statements: [deliveryInsert, pcCompletedAtUpdate],
    enqueueIfCompleted: async (pcCompletedAtCount: number) => {
      if (pcCompletedAtCount !== 1) return
      try {
        const delivery = await prisma.viewbookEmailDelivery.findUnique({
          where: { dedupKey: `vb-pc-complete:${viewbookId}` },
          select: { id: true },
        })
        if (delivery) {
          void enqueueViewbookEmail(delivery.id).catch((err) => {
            logError({ subsystem: 'viewbook', op: 'pc-complete-enqueue', viewbookId }, err)
          })
        }
      } catch (err) {
        logError({ subsystem: 'viewbook', op: 'pc-complete-select', viewbookId }, err)
      }
    },
  }
}

// ── Ack write ────────────────────────────────────────────────────────────

function ackPredicate(viewbookId: number, token: string, sectionKey: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Viewbook" v
    JOIN "Client" c ON c."id" = v."clientId"
    JOIN "ViewbookSection" s ON s."viewbookId" = v."id" AND s."sectionKey" = ${sectionKey}
    WHERE v."id" = ${viewbookId} AND v."token" = ${token} AND v."revokedAt" IS NULL
      AND c."archivedAt" IS NULL AND s."state" <> 'hidden' AND s."acknowledgedAt" IS NULL
  )`
}

export async function acknowledgeSection(
  viewbook: Viewbook,
  token: string,
  input: AcknowledgeSectionInput,
  hooks: MutationHooks = {},
): Promise<AcknowledgeSectionResult> {
  if (!isAckableSectionKey(input.sectionKey)) throw new HttpError(400, 'invalid_section')
  const sectionKey = input.sectionKey
  const clientMutationId = validateClientMutationId(input.clientMutationId)
  if (!clientMutationId) throw new HttpError(400, 'invalid_client_mutation_id')

  await hooks.beforeCommit?.()
  const now = Date.now()
  const P = ackPredicate(viewbook.id, token, sectionKey)
  const recipient = await resolvePcCompleteRecipient(viewbook.id)
  const completion = buildPcCompletion({
    viewbookId: viewbook.id,
    recipient,
    now,
    // Proves THIS txn stamped the section's acknowledgedAt — a re-ack that
    // hits the 0-row P fence never reaches this far, but a re-ack that
    // somehow raced past P (it can't, P requires acknowledgedAt IS NULL)
    // would still be blocked by this exact-timestamp match (Codex fix 2).
    extraGate: Prisma.sql`EXISTS (
      SELECT 1 FROM "ViewbookSection" sack
      WHERE sack."viewbookId" = ${viewbook.id} AND sack."sectionKey" = ${sectionKey} AND sack."acknowledgedAt" = ${now}
    )`,
  })

  const results = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, P),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${viewbook.id}, 'section-ack', 'client', ${`Acknowledged: ${sectionKey}`}, ${now}
      WHERE (${P})
    `,
    prisma.$executeRaw`
      UPDATE "ViewbookSection" SET "acknowledgedAt" = ${now}, "updatedAt" = ${now}
      WHERE "viewbookId" = ${viewbook.id} AND "sectionKey" = ${sectionKey} AND (${P})
    `,
    ...completion.statements,
  ])
  const [, activityCount, ackCount, , pcCompletedAtCount] = results as number[]

  if (ackCount === 1 && activityCount === 1) {
    if (pcCompletedAtCount === 1) await completion.enqueueIfCompleted(pcCompletedAtCount)
    const section = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: viewbook.id, sectionKey } },
    })
    return { acknowledged: section, pcCompleted: pcCompletedAtCount === 1, replayed: false }
  }
  if (ackCount !== activityCount) throw new Error('viewbook_ack_activity_mismatch')

  // Replay/no-op diagnosis (statement 7 of the brief): re-preflight for the
  // 404 oracle (unknown/revoked token, archived client), then distinguish
  // "already acked" (replay) from "hidden" (404) — a hidden ackable section
  // is never a valid ack target regardless of its prior acknowledgedAt.
  await requireViewbookToken(token)
  const section = await prisma.viewbookSection.findFirst({
    where: { viewbookId: viewbook.id, sectionKey },
  })
  if (!section || section.state === 'hidden') throw new HttpError(404, 'not_found')
  if (section.acknowledgedAt) {
    const vb = await prisma.viewbook.findUnique({ where: { id: viewbook.id }, select: { pcCompletedAt: true } })
    return { acknowledged: section, pcCompleted: vb?.pcCompletedAt != null, replayed: true }
  }
  throw new HttpError(404, 'not_found')
}

// ── Operator ack-reset ──────────────────────────────────────────────────
//
// Clears acknowledgedAt so the client can re-review + re-ack a section.
// NEVER clears pcCompletedAt (thank-you state is one-way, spec §4).

export async function resetSectionAck(viewbookId: number, sectionKey: string, actor: string): Promise<void> {
  if (!isAckableSectionKey(sectionKey)) throw new HttpError(400, 'invalid_section')
  const now = Date.now()
  const R = Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookSection"
    WHERE "viewbookId" = ${viewbookId} AND "sectionKey" = ${sectionKey} AND "acknowledgedAt" IS NOT NULL
  )`
  const [, activityCount, updateCount] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, R),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${viewbookId}, 'section-ack-reset', ${actor}, ${`Reset acknowledgment: ${sectionKey}`}, ${now}
      WHERE (${R})
    `,
    prisma.$executeRaw`
      UPDATE "ViewbookSection" SET "acknowledgedAt" = NULL, "updatedAt" = ${now}
      WHERE "viewbookId" = ${viewbookId} AND "sectionKey" = ${sectionKey} AND (${R})
    `,
  ])
  if (updateCount !== activityCount) throw new Error('viewbook_ack_reset_activity_mismatch')
}
