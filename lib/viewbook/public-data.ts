// Server loader for the public viewbook page (spec §8). The CORE load
// (token → viewbook + client + sections) must succeed; every other block
// (fields, milestones, materials, global content, overrides) is
// fault-isolated (loadOpsSnapshot precedent): a corrupt/failing block
// degrades to an empty/null value and is logged — the page never blanks.
// Returns null for EVERY token failure (page 404s — indistinguishable).

import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { requireViewbookToken } from './route-auth'
import { parseStoredTheme } from './theme'
import { CATALOG_CATEGORIES } from './catalog'
import { isViewbookStage, STAGE_LABELS, STAGE_LINEUPS, type ViewbookStage } from './stages'
import { getGlobalContent } from './global-content'
import {
  GLOBAL_CONTENT_KEYS,
  type ContentBlocks,
  type GlobalContentKey,
  type TeamMember,
} from './global-content-keys'
import type {
  PublicFieldCategory,
  PublicGlobalContent,
  PublicMaterialLink,
  PublicMilestone,
  PublicSection,
  ViewbookPublicData,
} from './public-types'

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

async function guarded<T>(op: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch (err) {
    logError({ subsystem: 'viewbook', op: `public-${op}` }, err)
    return fallback
  }
}

export async function loadViewbookPublicData(token: string): Promise<ViewbookPublicData | null> {
  let vb
  try {
    vb = await requireViewbookToken(token)
  } catch (err) {
    // Only the validator's controlled 404 means "invalid token". Anything
    // else (Prisma/db failure) is operational breakage — rethrow so the page
    // errors visibly instead of masquerading as a 404 (Codex plan-fix 1).
    if (err instanceof HttpError) return null
    throw err
  }

  const [client, sectionRows] = await Promise.all([
    prisma.client.findUnique({ where: { id: vb.clientId }, select: { name: true } }),
    prisma.viewbookSection.findMany({ where: { viewbookId: vb.id } }),
  ])
  if (!client) return null

  // Unknown stored stage degrades to 'building' (never blanks) — a corrupt
  // or pre-migration stage value must still render the fullest lineup.
  const stage: ViewbookStage = isViewbookStage(vb.stage) ? vb.stage : 'building'
  const lineup = STAGE_LINEUPS[stage]
  const visible = new Map(
    sectionRows.filter((s) => s.state !== 'hidden').map((s) => [s.sectionKey, s]),
  )
  const toPublic = (s: (typeof sectionRows)[number]): PublicSection => ({
    sectionKey: s.sectionKey as PublicSection['sectionKey'],
    state: s.state === 'done' ? 'done' : 'active',
    doneAt: iso(s.doneAt),
    acknowledgedAt: iso(s.acknowledgedAt),
    introNote: s.introNote,
    narrative: s.narrative,
  })
  const pick = (keys: readonly string[]) =>
    keys.flatMap((k) => (visible.has(k) ? [toPublic(visible.get(k)!)] : []))
  const primarySections = pick(lineup.primary)
  const carriedSections = pick(lineup.carried)

  const [fieldCategories, milestones, materials, global, overrides] = await Promise.all([
    guarded('fields', () => loadFieldCategories(vb.id), [] as PublicFieldCategory[]),
    guarded('milestones', () => loadMilestones(vb.id), [] as PublicMilestone[]),
    guarded('materials', () => loadMaterials(vb.id), [] as PublicMaterialLink[]),
    loadGlobal(), // self-guards PER KEY (Codex plan-fix 2)
    guarded('overrides', () => loadOverrides(vb.id), {} as Partial<Record<GlobalContentKey, string>>),
  ])

  return {
    clientName: client.name,
    kind: vb.kind,
    welcomeNote: vb.welcomeNote,
    dataLockedAt: iso(vb.dataLockedAt),
    theme: parseStoredTheme(vb.themeJson),
    stage,
    stageLabel: STAGE_LABELS[stage],
    syncVersion: vb.syncVersion,
    primarySections,
    carriedSections,
    fieldCategories,
    milestones,
    materials,
    global,
    overrides,
  }
}

async function loadFieldCategories(viewbookId: number): Promise<PublicFieldCategory[]> {
  const rows = await prisma.viewbookField.findMany({
    where: { viewbookId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { amendments: { orderBy: { id: 'asc' } } },
  })
  const catalogOrder: readonly string[] = CATALOG_CATEGORIES
  const byCategory = new Map<string, PublicFieldCategory>()
  const categories = [
    ...catalogOrder.filter((c) => rows.some((r) => r.category === c)),
    ...[...new Set(rows.map((r) => r.category))].filter((c) => !catalogOrder.includes(c)).sort(),
  ]
  for (const category of categories) byCategory.set(category, { category, fields: [] })
  for (const r of rows) {
    byCategory.get(r.category)?.fields.push({
      id: r.id,
      label: r.label,
      fieldType: r.fieldType,
      value: r.value,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      valueUpdatedBy: r.valueUpdatedBy,
      valueUpdatedAt: iso(r.valueUpdatedAt),
      isCustom: r.defKey == null,
      amendments: r.amendments.map((a) => ({
        id: a.id,
        value: a.value,
        author: a.author,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  }
  return [...byCategory.values()].filter((c) => c.fields.length > 0)
}

async function loadMilestones(viewbookId: number): Promise<PublicMilestone[]> {
  const rows = await prisma.viewbookMilestone.findMany({
    where: { viewbookId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      reviewLinks: {
        orderBy: { id: 'asc' },
        include: { feedback: { orderBy: { id: 'asc' } } },
      },
    },
  })
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    blurb: m.blurb,
    status: m.status,
    targetDate: iso(m.targetDate),
    doneAt: iso(m.doneAt),
    reviewLinks: m.reviewLinks.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
      kind: l.kind,
      feedback: l.feedback.map((f) => ({
        id: f.id,
        body: f.body,
        authorName: f.authorName,
        authorKind: f.authorKind,
        resolvedAt: iso(f.resolvedAt),
        createdAt: f.createdAt.toISOString(),
      })),
    })),
  }))
}

async function loadMaterials(viewbookId: number): Promise<PublicMaterialLink[]> {
  const rows = await prisma.viewbookMaterialLink.findMany({
    where: { viewbookId },
    orderBy: { id: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    url: r.url,
    addedBy: r.addedBy,
    providedAt: iso(r.providedAt),
  }))
}

async function loadGlobal(): Promise<PublicGlobalContent> {
  const out: PublicGlobalContent = { team: null, blocks: {} }
  for (const key of GLOBAL_CONTENT_KEYS) {
    // PER-KEY isolation (Codex plan-fix 2): getGlobalContent reads null on
    // corrupt/absent rows, and a thrown query failure degrades ONLY this key
    // — one bad key must not blank both Welcome and Strategy.
    const value = await guarded(`global-${key}`, () => getGlobalContent(key), null)
    if (key === 'team') out.team = (value as TeamMember[] | null) ?? null
    else out.blocks[key] = (value as ContentBlocks | null) ?? null
  }
  return out
}

async function loadOverrides(viewbookId: number): Promise<Partial<Record<GlobalContentKey, string>>> {
  const rows = await prisma.viewbookContentOverride.findMany({ where: { viewbookId } })
  const known: readonly string[] = GLOBAL_CONTENT_KEYS
  const out: Partial<Record<GlobalContentKey, string>> = {}
  for (const r of rows) {
    if (known.includes(r.contentKey)) out[r.contentKey as GlobalContentKey] = r.body
  }
  return out
}
