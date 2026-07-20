// Viewbook admin service layer (spec §4/§6/§10). Server-only.
//
// Invariants owned here:
// - Creation seeds sections/fields/milestones in ONE nested create (an
//   array-form transaction can't consume the autoincremented parent id).
// - Milestone promotion is a two-statement array transaction whose second
//   statement is fenced by { id, viewbookId } — a missing/cross-viewbook
//   target throws P2025 and rolls the demote back.
// - Asset attachment is file-write → DB-stamp → old-file-delete; a failed
//   stamp deletes the NEW file (no orphans).
// - Post-lock/amended fields are soft-archived, never hard-deleted (PR3
//   consumes archivedAt; nothing here deletes ViewbookField rows).

import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { CATALOG } from './catalog'
import { DEFAULT_MILESTONES } from './milestones'
import {
  SECTION_KEYS,
  type SectionKey,
  type ViewbookTheme,
  parseStoredTheme,
  validateViewbookTheme,
} from './theme'
import { isViewbookStage, nextStage, prevStage, type ViewbookStage } from './stages'
import { deleteViewbookAssets, saveViewbookAsset } from './assets'
import { appendActivityStatements } from './activity'
import { syncVersionBumpStatement, syncVersionBumpWhere } from './sync'
import {
  enqueueViewbookEmail,
  pcCompleteDeliveryInsert,
  resolvePcCompleteRecipient,
  stageChangeDeliveryStatements,
} from './email'
import { canonicalMailbox } from './global-content-keys'
import { getGlobalContent } from './global-content'
import { resolveAllowedNotifyRecipients } from './notify-recipients'

export type ViewbookKind = 'new-build' | 'upgrade'

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createViewbook(
  clientId: number,
  kind: ViewbookKind,
  createdBy: string,
): Promise<{ id: number; token: string }> {
  const client = await prisma.client.findUnique({ where: { id: clientId } })
  if (!client) throw new HttpError(404, 'not_found')
  if (client.archivedAt) throw new HttpError(409, 'client_archived')

  const token = crypto.randomUUID()
  try {
    const vb = await prisma.viewbook.create({
      data: {
        clientId,
        kind,
        token,
        createdBy,
        // PR5 Task 7: post-contract is the first stage a new viewbook enters
        // (spec fix 2) — the pc-* sections now have shipped renderers.
        stage: 'post-contract',
        sections: {
          create: SECTION_KEYS.map((sectionKey) => ({
            sectionKey,
            state: sectionKey === 'assessment' && kind === 'new-build' ? 'hidden' : 'active',
          })),
        },
        fields: {
          create: CATALOG.map((e) => ({
            defKey: e.defKey,
            category: e.category,
            label: e.label,
            fieldType: e.fieldType,
            sortOrder: e.sortOrder,
            createdBy: 'seed',
          })),
        },
        milestones: {
          create: DEFAULT_MILESTONES.map((m, i) => ({
            title: m.title,
            blurb: m.blurb,
            sortOrder: m.sortOrder,
            status: i === 0 ? 'current' : 'upcoming',
          })),
        },
      },
    })
    return { id: vb.id, token }
  } catch (err) {
    if (isP2002(err)) throw new HttpError(409, 'viewbook_exists')
    throw err
  }
}

export async function listViewbooks() {
  const rows = await prisma.viewbook.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      client: { select: { name: true, archivedAt: true } },
      milestones: { where: { status: 'current' }, select: { title: true } },
      _count: { select: { activities: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    clientName: r.client.name,
    clientArchived: r.client.archivedAt != null,
    kind: r.kind,
    token: r.token,
    revoked: r.revokedAt != null,
    stage: r.stage,
    pcCompletedAt: r.pcCompletedAt,
    currentMilestone: r.milestones[0]?.title ?? null,
    activityCount: r._count.activities,
    dataLockedAt: r.dataLockedAt,
    createdAt: r.createdAt,
  }))
}

export async function getViewbookAdmin(id: number) {
  const vb = await prisma.viewbook.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, archivedAt: true } },
      sections: { orderBy: { id: 'asc' } },
      fields: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }], include: { amendments: true } },
      milestones: {
        orderBy: { sortOrder: 'asc' },
        include: {
          reviewLinks: {
            include: { feedback: { include: { images: { orderBy: { sortOrder: 'asc' }, select: { filename: true } } } } },
          },
        },
      },
      contentOverrides: true,
      materialLinks: { orderBy: { id: 'asc' } },
    },
  })
  if (!vb) throw new HttpError(404, 'not_found')
  return { ...vb, theme: parseStoredTheme(vb.themeJson) }
}

// Theme PATCH saves colors/fonts ONLY. Asset references (logo, sectionHeroes)
// are single-owner: the atomic attachment flows below are the only writers —
// a stale editor tab's color save can therefore never resurrect a deleted
// asset filename (Codex PR1 review finding).
export async function updateViewbookTheme(id: number, raw: unknown): Promise<ViewbookTheme> {
  const vb = await prisma.viewbook.findUnique({ where: { id }, select: { themeJson: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const stored = parseStoredTheme(vb.themeJson)
  const incoming = validateViewbookTheme(raw)
  if (!incoming) throw new HttpError(400, 'invalid_theme')
  const theme: ViewbookTheme = { ...incoming, logo: stored.logo, sectionHeroes: stored.sectionHeroes }
  await mustUpdateViewbook(id, { themeJson: JSON.stringify(theme) }, { bump: true })
  return theme
}

const SETTINGS_CAPS = { welcomeNote: 2000, notifyEmail: 320 } as const

export async function updateViewbookSettings(
  id: number,
  patch: { welcomeNote?: string | null; notifyEmail?: string | null; kind?: ViewbookKind },
) {
  const data: Record<string, unknown> = {}
  if ('welcomeNote' in patch) {
    if (patch.welcomeNote != null && patch.welcomeNote.length > SETTINGS_CAPS.welcomeNote) {
      throw new HttpError(400, 'invalid_settings')
    }
    data.welcomeNote = patch.welcomeNote
  }
  if ('notifyEmail' in patch) {
    if (patch.notifyEmail != null && (patch.notifyEmail.length > SETTINGS_CAPS.notifyEmail || !patch.notifyEmail.includes('@'))) {
      throw new HttpError(400, 'invalid_settings')
    }
    data.notifyEmail = patch.notifyEmail
  }
  if (patch.kind !== undefined) {
    if (patch.kind !== 'new-build' && patch.kind !== 'upgrade') throw new HttpError(400, 'invalid_settings')
    data.kind = patch.kind
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, 'invalid_settings')
  // Mixed metadata (spec §6): welcomeNote/kind are rendered viewbook content and
  // bump; a notifyEmail-only patch is delivery metadata and must not.
  const bump = 'welcomeNote' in patch || patch.kind !== undefined
  await mustUpdateViewbook(id, data, { bump })
}

// PR4: atomic dual-column update (collapse affordance + hero overlay) with a
// single syncVersion bump — rendered presentation config, so it bumps like
// theme/welcomeNote (mustUpdateViewbook precedent). An empty patch is a
// deliberate no-op (route only calls this when parsePresentationPatch
// yielded at least one key).
export async function updateViewbookPresentation(
  id: number,
  patch: Partial<{
    collapseAffordance: string
    collapseMorph: string
    heroOverlayStrength: number
    revealDurationScale: number
    firstLoadDelayMs: number
  }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await prisma.$transaction([
    syncVersionBumpStatement(id),
    prisma.viewbook.update({ where: { id }, data: patch }),
  ])
}

export async function rotateViewbookToken(id: number): Promise<{ token: string }> {
  const token = crypto.randomUUID()
  await mustUpdateViewbook(id, { token, revokedAt: null })
  return { token }
}

export async function revokeViewbook(id: number): Promise<void> {
  await mustUpdateViewbook(id, { revokedAt: new Date() })
}

export async function setSectionState(
  id: number,
  sectionKey: string,
  state: 'hidden' | 'active' | 'done',
  actor: string,
): Promise<void> {
  assertSectionKey(sectionKey)
  if (!['hidden', 'active', 'done'].includes(state)) throw new HttpError(400, 'invalid_section')
  // (collapse is no longer a state — see lib/viewbook/collapse.ts, PR2)
  try {
    const update = prisma.viewbookSection.update({
        where: { viewbookId_sectionKey: { viewbookId: id, sectionKey } },
        data: { state, doneAt: state === 'done' ? new Date() : null },
      })
    // Unconditional bump joins the array (mechanism a) — the compound-where
    // update throws P2025 on an unknown section key, rolling the bump back.
    const statements = state === 'done'
      ? [syncVersionBumpStatement(id), update, ...appendActivityStatements(id, 'section-done', actor, `Completed ${sectionKey}`)]
      : [syncVersionBumpStatement(id), update]
    await prisma.$transaction(statements)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new HttpError(404, 'not_found')
    }
    throw err
  }
}

export async function updateSectionText(
  id: number,
  sectionKey: string,
  patch: { introNote?: string | null; narrative?: string | null },
): Promise<void> {
  assertSectionKey(sectionKey)
  const data: Record<string, unknown> = {}
  if ('introNote' in patch) {
    if (patch.introNote != null && patch.introNote.length > 4000) throw new HttpError(400, 'invalid_section')
    data.introNote = patch.introNote
  }
  if ('narrative' in patch) {
    if (patch.narrative != null && patch.narrative.length > 20_000) throw new HttpError(400, 'invalid_section')
    data.narrative = patch.narrative
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, 'invalid_section')
  // Unconditional bump joins the array (mechanism a) — the compound-where
  // update throws P2025 on an unknown viewbook/section pair, rolling the
  // bump back with it.
  await prisma.$transaction([
    syncVersionBumpStatement(id),
    prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey } },
      data,
    }),
  ])
}

function assertSectionKey(key: string): asserts key is SectionKey {
  if (!(SECTION_KEYS as readonly string[]).includes(key)) throw new HttpError(400, 'invalid_section')
}

// Fenced stage move (v2 PR1). The fence is the CALLER-supplied expectedStage
// (Codex plan fix 2 — a pre-read can't stop sequential double-steps): the
// compound-where update throws P2025 when the row's stage no longer matches,
// rolling the log + activity statements back with it (milestone-promote
// precedent above). eventKey is app-generated so PR3 can key stage-change
// deliveries in the SAME transaction (plan fix 1). PR5 adds the
// pcCompletedAt forward-fence + force. NO email side effects in PR1.
export async function moveViewbookStage(
  id: number,
  direction: 'forward' | 'back',
  expectedStage: ViewbookStage,
  actor: string,
  force = false,
): Promise<{ stage: ViewbookStage }> {
  if (direction !== 'forward' && direction !== 'back') throw new HttpError(400, 'invalid_direction')
  if (!isViewbookStage(expectedStage)) throw new HttpError(400, 'invalid_direction')
  const vb = await prisma.viewbook.findUnique({
    where: { id },
    select: { id: true, clientNotifyJson: true, stage: true, pcCompletedAt: true },
  })
  if (!vb) throw new HttpError(404, 'not_found')
  const target = direction === 'forward' ? nextStage(expectedStage) : prevStage(expectedStage)
  if (!target) throw new HttpError(409, 'stage_conflict')

  // PR5 Task 6: ack-to-stage forward fence — advancing OUT of post-contract
  // requires every ackable section to be client-acknowledged (the shared
  // buildPcCompletion gate in ack.ts stamps Viewbook.pcCompletedAt when that
  // happens), unless the operator explicitly forces it below.
  const isForwardOutOfPostContract = direction === 'forward' && expectedStage === 'post-contract'
  if (isForwardOutOfPostContract && vb.pcCompletedAt == null && !force) {
    throw new HttpError(409, 'ack_incomplete')
  }

  const eventKey = crypto.randomUUID()
  // Shared allowed-set resolver (PR5 Task 4) — the SAME set setNotifyEmails
  // (setup.ts) validates writes against, so the two surfaces can never drift.
  const allowed = await resolveAllowedNotifyRecipients(id)
  let requested: unknown = []
  try {
    requested = JSON.parse(vb.clientNotifyJson)
  } catch {
    requested = []
  }
  const recipients = direction === 'forward' && Array.isArray(requested)
    ? [...new Set(requested.flatMap((raw) => {
      const email = canonicalMailbox(raw)
      return email && allowed.has(email) ? [email] : []
    }))]
    : []
  const deliveryStatements = stageChangeDeliveryStatements({ viewbookId: id, eventKey, recipients })

  // Force-out-of-post-contract (Task 6): stamp pcCompletedAt + create the
  // SAME pc-complete delivery the natural-ack path creates (Task 2's
  // pcCompleteDeliveryInsert, ON CONFLICT("dedupKey") DO NOTHING — a
  // concurrent/prior ack completion can never double-send). G is gated on the
  // row's OWN stage/pcCompletedAt at commit time: a lost race, an
  // already-completed viewbook, or force on a non-post-contract forward all
  // make this a harmless 0-row no-op. These statements MUST run BEFORE the
  // expectedStage stage-update below — G requires stage = expectedStage,
  // which that update flips.
  let forcePcCompleteGate: Prisma.Sql | null = null
  if (isForwardOutOfPostContract && force) {
    forcePcCompleteGate = Prisma.sql`
      EXISTS (
        SELECT 1 FROM "Viewbook" vfc
        WHERE vfc."id" = ${id} AND vfc."stage" = ${expectedStage} AND vfc."pcCompletedAt" IS NULL
      )
    `
  }
  const forceNow = Date.now()
  const forceStatements = forcePcCompleteGate
    ? [
        pcCompleteDeliveryInsert({
          viewbookId: id,
          recipient: await resolvePcCompleteRecipient(id),
          predicate: forcePcCompleteGate,
        }),
        prisma.$executeRaw`
          UPDATE "Viewbook" SET "pcCompletedAt" = ${forceNow}, "updatedAt" = ${forceNow}
          WHERE "id" = ${id} AND (${forcePcCompleteGate})
        `,
      ]
    : []

  let results: unknown[]
  try {
    // Unconditional bump joins the array (mechanism a) — the expectedStage
    // compound-where update throws P2025 on the loser of a race, rolling the
    // bump back with the log + activity rows (and the force stamp, if any).
    results = await prisma.$transaction([
      syncVersionBumpStatement(id),
      ...forceStatements,
      prisma.viewbook.update({ where: { id, stage: expectedStage }, data: { stage: target } }),
      prisma.viewbookStageLog.create({ data: { viewbookId: id, eventKey, stage: target, direction, actor } }),
      ...deliveryStatements,
      ...appendActivityStatements(id, 'stage-change', actor, `Moved to stage: ${target}`),
    ])
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new HttpError(409, 'stage_conflict')
    }
    throw err
  }

  if (forceStatements.length > 0) {
    // Index 2: [0]=bump, [1]=force pc-complete delivery insert, [2]=force
    // pcCompletedAt update — forceStatements is always exactly these two.
    const pcCompletedAtCount = results[2] as number
    if (pcCompletedAtCount === 1) {
      try {
        const delivery = await prisma.viewbookEmailDelivery.findUnique({
          where: { dedupKey: `vb-pc-complete:${id}` },
          select: { id: true },
        })
        if (delivery) {
          void enqueueViewbookEmail(delivery.id).catch((err) => {
            logError({ subsystem: 'viewbook', op: 'pc-complete-enqueue', viewbookId: id }, err)
          })
        }
      } catch (err) {
        logError({ subsystem: 'viewbook', op: 'pc-complete-select', viewbookId: id }, err)
      }
    }
  }

  if (recipients.length > 0) {
    try {
      const dedupKeys = recipients.map((recipient) => `vb-stage:${eventKey}:${recipient}`)
      const deliveries = await prisma.viewbookEmailDelivery.findMany({
        where: { dedupKey: { in: dedupKeys } },
        select: { id: true },
      })
      for (const delivery of deliveries) {
        void enqueueViewbookEmail(delivery.id).catch((err) => {
          logError({ subsystem: 'viewbook', op: 'stage-email-enqueue', viewbookId: id, deliveryId: delivery.id }, err)
        })
      }
    } catch (err) {
      logError({ subsystem: 'viewbook', op: 'stage-email-select', viewbookId: id, eventKey }, err)
    }
  }
  return { stage: target }
}

export interface AssignViewbookCsmDeps {
  beforeWrite?: () => Promise<void>
}

export async function assignViewbookCsm(
  id: number,
  csmName: string | null,
  actor: string,
  deps: AssignViewbookCsmDeps = {},
): Promise<void> {
  const viewbook = await prisma.viewbook.findUnique({
    where: { id },
    select: { csmName: true, client: { select: { archivedAt: true } } },
  })
  if (!viewbook) throw new HttpError(404, 'not_found')
  if (viewbook.client.archivedAt) throw new HttpError(409, 'client_archived')

  if (csmName !== null) {
    const team = await getGlobalContent('team')
    const valid = Array.isArray(team) && team.some((member) => member.isCsm === true && member.name === csmName)
    if (!valid) throw new HttpError(400, 'invalid_csm')
  }
  if (viewbook.csmName === csmName) return

  if (deps.beforeWrite) await deps.beforeWrite()

  const predicate = Prisma.sql`EXISTS (
    SELECT 1
    FROM "Viewbook" AS "vb_csm"
    JOIN "Client" AS "client_csm" ON "client_csm"."id" = "vb_csm"."clientId"
    WHERE "vb_csm"."id" = ${id}
      AND "client_csm"."archivedAt" IS NULL
      AND "vb_csm"."csmName" IS NOT ${csmName}
  )`
  const now = Date.now()
  const summary = csmName === null ? 'Cleared CSM assignment' : `Assigned CSM: ${csmName}`
  await prisma.$transaction([
    syncVersionBumpWhere(id, predicate),
    prisma.$executeRaw`
      INSERT INTO "ViewbookActivity" ("viewbookId", "kind", "actor", "summary", "createdAt")
      SELECT ${id}, 'csm-assigned', ${actor}, ${summary}, ${now}
      WHERE (${predicate})
    `,
    prisma.$executeRaw`
      UPDATE "Viewbook"
      SET "csmName" = ${csmName}, "updatedAt" = ${now}
      WHERE "id" = ${id} AND (${predicate})
    `,
  ])
}

// ── Milestones ──────────────────────────────────────────────────────────────

const MILESTONE_STATUSES = ['upcoming', 'current', 'done'] as const
type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]
const MILESTONE_DESCRIPTION_CAP = 2000

function validateMilestoneDescription(description: string | null | undefined): void {
  if (description == null) return
  if (typeof description !== 'string' || description.length > MILESTONE_DESCRIPTION_CAP) {
    throw new HttpError(400, 'invalid_description')
  }
}

export async function createMilestone(
  viewbookId: number,
  data: { title: string; blurb?: string | null; sortOrder: number; targetDate?: Date | null; description?: string | null },
  opts: { current?: boolean } = {},
) {
  if (!data.title || data.title.length > 200) throw new HttpError(400, 'invalid_milestone')
  validateMilestoneDescription(data.description)
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  if (opts.current) {
    // Unconditional bump joins the array (mechanism a) — the create throws
    // on failure, rolling the bump + demote back with it.
    const [, , created] = await prisma.$transaction([
      syncVersionBumpStatement(viewbookId),
      prisma.viewbookMilestone.updateMany({
        where: { viewbookId, status: 'current' },
        data: { status: 'upcoming' },
      }),
      prisma.viewbookMilestone.create({
        data: { viewbookId, title: data.title, blurb: data.blurb ?? null, sortOrder: data.sortOrder, targetDate: data.targetDate ?? null, description: data.description ?? null, status: 'current' },
      }),
    ])
    return created
  }
  const [, created] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${viewbookId})`),
    prisma.viewbookMilestone.create({
      data: { viewbookId, title: data.title, blurb: data.blurb ?? null, sortOrder: data.sortOrder, targetDate: data.targetDate ?? null, description: data.description ?? null },
    }),
  ])
  return created
}

export async function updateMilestone(
  viewbookId: number,
  milestoneId: number,
  patch: { title?: string; blurb?: string | null; sortOrder?: number; targetDate?: Date | null; status?: MilestoneStatus; description?: string | null },
) {
  const data: Record<string, unknown> = {}
  if (patch.title !== undefined) {
    if (!patch.title || patch.title.length > 200) throw new HttpError(400, 'invalid_milestone')
    data.title = patch.title
  }
  if ('blurb' in patch) data.blurb = patch.blurb
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder
  if ('targetDate' in patch) data.targetDate = patch.targetDate
  if (patch.status !== undefined) {
    if (!MILESTONE_STATUSES.includes(patch.status)) throw new HttpError(400, 'invalid_milestone')
    data.status = patch.status
    data.doneAt = patch.status === 'done' ? new Date() : null
  }
  if ('description' in patch) {
    validateMilestoneDescription(patch.description)
    data.description = patch.description ?? null
  }
  if (Object.keys(data).length === 0) throw new HttpError(400, 'invalid_milestone')

  if (patch.status === 'current') {
    // Fenced promote: the second statement's compound where throws P2025 on a
    // missing/cross-viewbook target and rolls the demote (+ bump) back with it.
    const [, , updated] = await prisma.$transaction([
      syncVersionBumpStatement(viewbookId),
      prisma.viewbookMilestone.updateMany({
        where: { viewbookId, status: 'current', id: { not: milestoneId } },
        data: { status: 'upcoming' },
      }),
      prisma.viewbookMilestone.update({ where: { id: milestoneId, viewbookId }, data }),
    ])
    return updated
  }
  // Unconditional bump joins the array (mechanism a) — the compound-where
  // update throws P2025 on a missing/cross-viewbook target, rolling the
  // bump back with it.
  const [, updated] = await prisma.$transaction([
    syncVersionBumpStatement(viewbookId),
    prisma.viewbookMilestone.update({ where: { id: milestoneId, viewbookId }, data }),
  ])
  return updated
}

export async function deleteMilestone(viewbookId: number, milestoneId: number): Promise<void> {
  const [, res] = await prisma.$transaction([
    syncVersionBumpWhere(
      viewbookId,
      Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookMilestone" WHERE "id" = ${milestoneId} AND "viewbookId" = ${viewbookId})`,
    ),
    prisma.viewbookMilestone.deleteMany({ where: { id: milestoneId, viewbookId } }),
  ])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}

// ── Catalog sync ────────────────────────────────────────────────────────────

// Concurrent-idempotent: per-row create with narrow P2002 skip (SQLite Prisma
// has no createMany skipDuplicates; find-missing-then-createMany races).
export async function syncCatalogQuestions(viewbookId: number): Promise<{ added: number }> {
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const existing = await prisma.viewbookField.findMany({
    where: { viewbookId, defKey: { not: null } },
    select: { defKey: true },
  })
  const have = new Set(existing.map((f) => f.defKey))
  let added = 0
  for (const e of CATALOG) {
    if (have.has(e.defKey)) continue
    try {
      // Each admitted insert is its own bump+create transaction (mechanism
      // a, per-row): a concurrent-loser P2002 rolls the bump back along with
      // the skipped row — atomicity beats increment-exactness (Codex wave-2
      // fix 1).
      await prisma.$transaction([
        syncVersionBumpStatement(viewbookId),
        prisma.viewbookField.create({
          data: {
            viewbookId,
            defKey: e.defKey,
            category: e.category,
            label: e.label,
            fieldType: e.fieldType,
            sortOrder: e.sortOrder,
            createdBy: 'seed',
          },
        }),
      ])
      added += 1
    } catch (err) {
      if (!isP2002(err)) throw err
    }
  }
  return { added }
}

// ── Asset attachment (atomic: write → stamp → delete-old; failed stamp
//    deletes the NEW file) ───────────────────────────────────────────────────

export async function attachViewbookLogo(viewbookId: number, buf: Buffer): Promise<ViewbookTheme> {
  return attachThemeAsset(viewbookId, buf, (theme, filename) => ({ ...theme, logo: filename }))
}

export async function attachSectionHero(
  viewbookId: number,
  sectionKey: string,
  buf: Buffer,
): Promise<ViewbookTheme> {
  assertSectionKey(sectionKey)
  return attachThemeAsset(viewbookId, buf, (theme, filename) => ({
    ...theme,
    sectionHeroes: { ...theme.sectionHeroes, [sectionKey]: filename },
  }))
}

async function attachThemeAsset(
  viewbookId: number,
  buf: Buffer,
  place: (theme: ViewbookTheme, filename: string) => ViewbookTheme,
): Promise<ViewbookTheme> {
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { themeJson: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const before = parseStoredTheme(vb.themeJson)
  const scope = String(viewbookId)

  const { filename } = await saveViewbookAsset(scope, buf)
  const next = place(before, filename)
  const validated = validateViewbookTheme(next)
  if (!validated) {
    await deleteViewbookAssets(scope, [filename])
    throw new HttpError(400, 'invalid_theme')
  }
  try {
    // Conditional stamp fenced on the loaded themeJson: a concurrent theme
    // write means 0 rows — delete the new file, honest 409. The bump shares
    // the SAME fence (mechanism c) so a lost race bumps nothing.
    const [, res] = await prisma.$transaction([
      syncVersionBumpWhere(
        viewbookId,
        Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${viewbookId} AND "themeJson" IS ${vb.themeJson})`,
      ),
      prisma.viewbook.updateMany({
        where: { id: viewbookId, themeJson: vb.themeJson },
        data: { themeJson: JSON.stringify(validated) },
      }),
    ])
    if (res.count === 0) {
      await deleteViewbookAssets(scope, [filename])
      throw new HttpError(409, 'theme_conflict')
    }
  } catch (err) {
    if (!(err instanceof HttpError)) await deleteViewbookAssets(scope, [filename])
    throw err
  }

  // Success: retire the replaced file (if any).
  const replaced = diffThemeFilenames(before, validated)
  if (replaced.length > 0) await deleteViewbookAssets(scope, replaced)
  return validated
}

function themeFilenames(theme: ViewbookTheme): string[] {
  return [theme.logo, ...Object.values(theme.sectionHeroes)].filter((f): f is string => f != null)
}

function diffThemeFilenames(before: ViewbookTheme, after: ViewbookTheme): string[] {
  const kept = new Set(themeFilenames(after))
  return themeFilenames(before).filter((f) => !kept.has(f))
}

// ── Delete lifecycle ────────────────────────────────────────────────────────

// Feedback screenshots live as scoped asset files referenced only by
// ViewbookFeedbackImage rows (cascade-deleted with the viewbook) — snapshot
// their filenames BEFORE the delete or the files leak.
function feedbackImageFilenames(viewbookId: number): Promise<{ filename: string }[]> {
  return prisma.viewbookFeedbackImage.findMany({
    where: { feedback: { reviewLink: { milestone: { viewbookId } } } },
    select: { filename: true },
  })
}

export async function deleteViewbook(id: number): Promise<void> {
  const vb = await prisma.viewbook.findUnique({
    where: { id },
    select: { themeJson: true, docs: { select: { filename: true } } },
  })
  if (!vb) throw new HttpError(404, 'not_found')
  const feedbackImages = await feedbackImageFilenames(id)
  const snapshot = [
    ...themeFilenames(parseStoredTheme(vb.themeJson)),
    ...vb.docs.map((doc) => doc.filename),
    ...feedbackImages.map((img) => img.filename),
  ]
  await prisma.viewbook.delete({ where: { id } })
  await deleteViewbookAssets(String(id), snapshot)
}

// For the client DELETE route: snapshot BEFORE the cascade, best-effort file
// cleanup after (a bare Client cascade would leak the files).
export async function collectClientViewbookAssetSnapshot(
  clientId: number,
): Promise<{ viewbookId: number; filenames: string[] } | null> {
  const vb = await prisma.viewbook.findUnique({
    where: { clientId },
    select: { id: true, themeJson: true, docs: { select: { filename: true } } },
  })
  if (!vb) return null
  const feedbackImages = await feedbackImageFilenames(vb.id)
  return {
    viewbookId: vb.id,
    filenames: [
      ...themeFilenames(parseStoredTheme(vb.themeJson)),
      ...vb.docs.map((doc) => doc.filename),
      ...feedbackImages.map((img) => img.filename),
    ],
  }
}

// bump: true rides the same array-form transaction as the updateMany
// (mechanism c) — predicated on the row still existing, mirroring the
// updateMany's own `where`. bump: false (default) covers rotate/revoke,
// which are token/delivery metadata, never rendered content (spec §6).
async function mustUpdateViewbook(
  id: number,
  data: Record<string, unknown>,
  opts: { bump?: boolean } = {},
): Promise<void> {
  if (opts.bump) {
    const [, res] = await prisma.$transaction([
      syncVersionBumpWhere(id, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${id})`),
      prisma.viewbook.updateMany({ where: { id }, data }),
    ])
    if (res.count === 0) throw new HttpError(404, 'not_found')
    return
  }
  const res = await prisma.viewbook.updateMany({ where: { id }, data })
  if (res.count === 0) throw new HttpError(404, 'not_found')
}
