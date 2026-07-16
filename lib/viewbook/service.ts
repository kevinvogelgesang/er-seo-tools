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
import { CATALOG } from './catalog'
import { DEFAULT_MILESTONES } from './milestones'
import {
  SECTION_KEYS,
  type SectionKey,
  type ViewbookTheme,
  parseStoredTheme,
  validateViewbookTheme,
} from './theme'
import { deleteViewbookAssets, saveViewbookAsset } from './assets'

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
      milestones: { orderBy: { sortOrder: 'asc' }, include: { reviewLinks: { include: { feedback: true } } } },
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
  await mustUpdateViewbook(id, { themeJson: JSON.stringify(theme) })
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
  await mustUpdateViewbook(id, data)
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
): Promise<void> {
  assertSectionKey(sectionKey)
  if (!['hidden', 'active', 'done'].includes(state)) throw new HttpError(400, 'invalid_section')
  try {
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey } },
      data: { state, doneAt: state === 'done' ? new Date() : null },
    })
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
  await prisma.viewbookSection.update({
    where: { viewbookId_sectionKey: { viewbookId: id, sectionKey } },
    data,
  })
}

function assertSectionKey(key: string): asserts key is SectionKey {
  if (!(SECTION_KEYS as readonly string[]).includes(key)) throw new HttpError(400, 'invalid_section')
}

// ── Milestones ──────────────────────────────────────────────────────────────

const MILESTONE_STATUSES = ['upcoming', 'current', 'done'] as const
type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

export async function createMilestone(
  viewbookId: number,
  data: { title: string; blurb?: string | null; sortOrder: number; targetDate?: Date | null },
  opts: { current?: boolean } = {},
) {
  if (!data.title || data.title.length > 200) throw new HttpError(400, 'invalid_milestone')
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  if (opts.current) {
    const [, created] = await prisma.$transaction([
      prisma.viewbookMilestone.updateMany({
        where: { viewbookId, status: 'current' },
        data: { status: 'upcoming' },
      }),
      prisma.viewbookMilestone.create({
        data: { viewbookId, title: data.title, blurb: data.blurb ?? null, sortOrder: data.sortOrder, targetDate: data.targetDate ?? null, status: 'current' },
      }),
    ])
    return created
  }
  return prisma.viewbookMilestone.create({
    data: { viewbookId, title: data.title, blurb: data.blurb ?? null, sortOrder: data.sortOrder, targetDate: data.targetDate ?? null },
  })
}

export async function updateMilestone(
  viewbookId: number,
  milestoneId: number,
  patch: { title?: string; blurb?: string | null; sortOrder?: number; targetDate?: Date | null; status?: MilestoneStatus },
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
  if (Object.keys(data).length === 0) throw new HttpError(400, 'invalid_milestone')

  if (patch.status === 'current') {
    // Fenced promote: the second statement's compound where throws P2025 on a
    // missing/cross-viewbook target and rolls the demote back with it.
    const [, updated] = await prisma.$transaction([
      prisma.viewbookMilestone.updateMany({
        where: { viewbookId, status: 'current', id: { not: milestoneId } },
        data: { status: 'upcoming' },
      }),
      prisma.viewbookMilestone.update({ where: { id: milestoneId, viewbookId }, data }),
    ])
    return updated
  }
  return prisma.viewbookMilestone.update({ where: { id: milestoneId, viewbookId }, data })
}

export async function deleteMilestone(viewbookId: number, milestoneId: number): Promise<void> {
  const res = await prisma.viewbookMilestone.deleteMany({ where: { id: milestoneId, viewbookId } })
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
      await prisma.viewbookField.create({
        data: {
          viewbookId,
          defKey: e.defKey,
          category: e.category,
          label: e.label,
          fieldType: e.fieldType,
          sortOrder: e.sortOrder,
          createdBy: 'seed',
        },
      })
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
    // write means 0 rows — delete the new file, honest 409.
    const res = await prisma.viewbook.updateMany({
      where: { id: viewbookId, themeJson: vb.themeJson },
      data: { themeJson: JSON.stringify(validated) },
    })
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

export async function deleteViewbook(id: number): Promise<void> {
  const vb = await prisma.viewbook.findUnique({ where: { id }, select: { themeJson: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const snapshot = themeFilenames(parseStoredTheme(vb.themeJson))
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
    select: { id: true, themeJson: true },
  })
  if (!vb) return null
  return { viewbookId: vb.id, filenames: themeFilenames(parseStoredTheme(vb.themeJson)) }
}

async function mustUpdateViewbook(id: number, data: Record<string, unknown>): Promise<void> {
  const res = await prisma.viewbook.updateMany({ where: { id }, data })
  if (res.count === 0) throw new HttpError(404, 'not_found')
}
