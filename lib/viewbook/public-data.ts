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
import { listViewbookDocs } from './docs'
import {
  GLOBAL_CONTENT_KEYS,
  type ContentBlocks,
  type GlobalContentKey,
  type TeamMember,
} from './global-content-keys'
import { viewbookDisplayName } from './display-name'
import type {
  PublicFieldCategory,
  PublicGlobalContent,
  PublicMaterialLink,
  PublicMilestone,
  PublicSection,
  PublicTeamMember,
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
    collapsedShared: s.collapsedShared,
    doneAt: iso(s.doneAt),
    acknowledgedAt: iso(s.acknowledgedAt),
    introNote: s.introNote,
    narrative: s.narrative,
  })
  const pick = (keys: readonly string[]) =>
    keys.flatMap((k) => (visible.has(k) ? [toPublic(visible.get(k)!)] : []))
  const pcCompletedAt = iso(vb.pcCompletedAt)
  // pc-thanks nav-exclusion (Codex fix 10): a component-only null gate would
  // still leave a dead ProgressNav dot for an unreached section. STAGE_LINEUPS
  // doesn't carry 'pc-thanks' yet (Task 7 activates it) — gatePcThanks is
  // exported/pure so this can be exercised directly today and needs no
  // changes when the lineup lands it.
  const primarySections = gatePcThanks(pick(lineup.primary), pcCompletedAt)
  const carriedSections = pick(lineup.carried)

  const [fieldCategories, milestones, materials, docs, global, overrides, teamMembers] = await Promise.all([
    guarded('fields', () => loadFieldCategories(vb.id), [] as PublicFieldCategory[]),
    guarded('milestones', () => loadMilestones(vb.id), [] as PublicMilestone[]),
    guarded('materials', () => loadMaterials(vb.id), [] as PublicMaterialLink[]),
    guarded('docs', () => listViewbookDocs(vb.id), { global: [], own: [] }),
    loadGlobal(), // self-guards PER KEY (Codex plan-fix 2)
    guarded('overrides', () => loadOverrides(vb.id), {} as Partial<Record<GlobalContentKey, string>>),
    guarded('team-members', () => loadTeamMembers(vb.id), [] as PublicTeamMember[]),
  ])

  // Header display-name (spec §7): the client-entered school-name answer
  // wins over the CRM client record name. Reuses the already-loaded (and
  // fault-isolated) fieldCategories rather than a second query — a failed
  // fields block degrades this to clientName too, same as everything else.
  const schoolNameValue =
    fieldCategories.flatMap((c) => c.fields).find((f) => f.defKey === 'school-name')?.value ?? null
  const displayName = viewbookDisplayName({ schoolNameValue, clientName: client.name })

  return {
    viewbookId: vb.id,
    clientName: client.name,
    displayName,
    csmName: vb.csmName,
    kind: vb.kind,
    welcomeNote: vb.welcomeNote,
    dataLockedAt: iso(vb.dataLockedAt),
    theme: parseStoredTheme(vb.themeJson),
    stage,
    stageLabel: STAGE_LABELS[stage],
    syncVersion: vb.syncVersion,
    pcCompletedAt,
    clientNotifyJson: parseClientNotifyJson(vb.clientNotifyJson),
    teamMembers,
    primarySections,
    carriedSections,
    fieldCategories,
    milestones,
    materials,
    docs,
    global,
    overrides,
  }
}

// Exported for direct unit testing (see note above): drops 'pc-thanks' from
// an already-computed section list when the stage hasn't been completed yet.
export function gatePcThanks(sections: PublicSection[], pcCompletedAt: string | null): PublicSection[] {
  return pcCompletedAt != null ? sections : sections.filter((s) => s.sectionKey !== 'pc-thanks')
}

function parseClientNotifyJson(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? parsed : []
  } catch {
    return []
  }
}

// PR5 pc-invite roster. `invited` is existence-only (Codex fix 7): a
// team-invite ViewbookEmailDelivery row for the member exists, never
// send/suppress status — rendering sentAt/suppressedAt would turn the email
// job's marker writes into rendered-data mutations that would then need to
// bump syncVersion, which they deliberately don't.
async function loadTeamMembers(viewbookId: number): Promise<PublicTeamMember[]> {
  const [members, deliveries] = await Promise.all([
    prisma.viewbookTeamMember.findMany({
      where: { viewbookId },
      orderBy: { id: 'asc' },
      select: { id: true, memberKey: true, name: true, email: true },
    }),
    prisma.viewbookEmailDelivery.findMany({
      where: { viewbookId, kind: 'team-invite' },
      select: { dedupKey: true },
    }),
  ])
  return members.map((m) => ({
    id: m.id,
    memberKey: m.memberKey,
    name: m.name,
    email: m.email,
    invited: deliveries.some((d) => d.dedupKey.startsWith(`vb-invite:${m.memberKey}:`)),
  }))
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
      defKey: r.defKey,
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
    description: m.description,
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
  const out: PublicGlobalContent = { team: null, pcIntro: null, blocks: {} }
  for (const key of GLOBAL_CONTENT_KEYS) {
    // PER-KEY isolation (Codex plan-fix 2): getGlobalContent reads null on
    // corrupt/absent rows, and a thrown query failure degrades ONLY this key
    // — one bad key must not blank both Welcome and Strategy.
    const value = await guarded(`global-${key}`, () => getGlobalContent(key), null)
    if (key === 'team') out.team = (value as TeamMember[] | null) ?? null
    else if (key === 'pc-intro') out.pcIntro = (value as string | null) ?? null
    else out.blocks[key as Exclude<GlobalContentKey, 'team' | 'pc-intro'>] = (value as ContentBlocks | null) ?? null
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
