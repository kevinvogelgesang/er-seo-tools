// F2 copy-on-create snapshot engine (spec §5, Task 3).
//
// ONE pure projection (`projectInstanceTree` / `projectSectionInstance` /
// `offeringAvailability`) turns RAW template rows (loadTemplateTreeRaw — raw
// JSON strings, never getTemplateTree's decoded views, Codex fix #5) into the
// nested instance-tree inputs `createViewbook` persists, plus the member-mapped
// `assetPlan` phase 2 consumes (captured BEFORE the welcome roster photo refs
// are null-stripped — Codex fix #8a: once phase 1 writes `photo: null`, the
// stored row no longer knows which source files to copy).
//
// `snapshotInstanceAssets` is the impure phase 2: per plan entry it copies the
// referenced global files into the viewbook's own asset scope and rewrites the
// subsection contentJson in ONE array-form txn fenced on the subsection's
// version (fence loss → delete the new files + logError). Best-effort by
// contract — a phase-2 failure leaves a photoless but working viewbook; the
// §6 equal-version pull repairs it.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { isPlainObject } from './content-validators'
import { ASSET_FILENAME_RE } from './theme'
import { deleteViewbookAssets, readViewbookAsset, saveViewbookAsset } from './assets'
import { syncVersionBumpWhere } from './sync'

// ---- raw template shapes (structural supertypes of the Prisma rows) --------

export interface RawTemplateField {
  id: number
  fieldKey: string
  label: string
  fieldType: string
  sortOrder: number
  archivedAt: Date | null
}

export interface RawTemplateSubsection {
  id: number
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copyJson: string | null
  contentJson: string | null
  sortOrder: number
  archivedAt: Date | null
  fields: RawTemplateField[]
}

export interface RawTemplateSection {
  id: number
  templateKey: string
  rendererType: string
  title: string
  copyJson: string
  contentJson: string | null
  sortOrder: number
  version: number
  archivedAt: Date | null
  subsections: RawTemplateSubsection[]
}

// ---- instance-tree inputs ---------------------------------------------------

export interface ViewbookOfferings {
  website: boolean
  va: boolean
  ppc: boolean
}

export const DEFAULT_OFFERINGS: ViewbookOfferings = { website: true, va: false, ppc: false }

export interface FieldInstanceInput {
  defKey: string
  category: string
  label: string
  fieldType: string
  sortOrder: number
  createdBy: 'seed'
}

export interface SubsectionInstanceInput {
  subsectionTemplateId: number
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copyJson: string | null
  contentJson: string | null
  sortOrder: number
  fields: FieldInstanceInput[]
}

export interface SectionInstanceInput {
  sectionKey: string
  state: string
  sectionTemplateId: number
  rendererType: string
  title: string
  copyJson: string
  contentJson: string | null
  sortOrder: number
  templateVersion: number
  subsections: SubsectionInstanceInput[]
}

export interface AssetPlanRef {
  memberName: string
  filename: string
}

export interface AssetPlanEntry {
  sectionKey: string
  subsectionKey: string
  refs: AssetPlanRef[]
}

// ---- pure projection --------------------------------------------------------

function matchesOfferings(sub: RawTemplateSubsection, offerings: ViewbookOfferings): boolean {
  return (
    (sub.offeringWebsite && offerings.website) ||
    (sub.offeringVa && offerings.va) ||
    (sub.offeringPpc && offerings.ppc)
  )
}

// The effective renderer of a subsection's content — the SAME convention as
// getTemplateTree's read side: the ONE 'main' subsection carries the section's
// own rendererType; everything else is 'generic'.
function effectiveRendererType(section: RawTemplateSection, sub: RawTemplateSubsection): string {
  return sub.subsectionKey === 'main' ? section.rendererType : 'generic'
}

// Welcome roster photo strip (spec §5 phase 1): instance content NEVER carries
// a 'global'-scope filename — refs are captured member-mapped for phase 2,
// then every photo becomes null. Guard leniency mirrors
// extractInstanceAssetRefs exactly (plain object, v === 1, team array): a doc
// the extractor would find no refs in is copied verbatim — the two seams can
// never disagree about which files instance content references.
function stripWelcomeRosterPhotos(contentJson: string | null): {
  contentJson: string | null
  refs: AssetPlanRef[]
} {
  if (contentJson === null) return { contentJson, refs: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(contentJson)
  } catch {
    return { contentJson, refs: [] }
  }
  if (!isPlainObject(parsed) || parsed.v !== 1 || !Array.isArray(parsed.team)) {
    return { contentJson, refs: [] }
  }
  const refs: AssetPlanRef[] = []
  const team = parsed.team.map((member) => {
    if (!isPlainObject(member)) return member
    const { photo, name } = member
    if (photo === null || photo === undefined) return member
    if (typeof photo === 'string' && typeof name === 'string' && name.length > 0 && ASSET_FILENAME_RE.test(photo)) {
      refs.push({ memberName: name, filename: photo })
    }
    // ANY non-null photo value is nulled — an unmapped/invalid ref degrades
    // honestly to photoless instead of leaking a template-scope name.
    return { ...member, photo: null }
  })
  return { contentJson: JSON.stringify({ ...parsed, team }), refs }
}

export interface ProjectedSectionInstance {
  section: SectionInstanceInput
  assetPlan: AssetPlanEntry[]
}

/**
 * Single-section projection (used by the tree below; pull/offering-enable
 * reuse it in later tasks). Returns null when the section is archived or has
 * no active subsection matching the enabled offerings (D5 inclusion rule).
 * `state` is always 'active' here — the tree-level kind rule overrides it.
 */
export function projectSectionInstance(
  raw: RawTemplateSection,
  offerings: ViewbookOfferings,
): ProjectedSectionInstance | null {
  if (raw.archivedAt !== null) return null
  const matching = raw.subsections.filter((sub) => sub.archivedAt === null && matchesOfferings(sub, offerings))
  if (matching.length === 0) return null

  const assetPlan: AssetPlanEntry[] = []
  const subsections: SubsectionInstanceInput[] = matching.map((sub) => {
    let contentJson = sub.contentJson
    if (effectiveRendererType(raw, sub) === 'welcome') {
      const stripped = stripWelcomeRosterPhotos(sub.contentJson)
      contentJson = stripped.contentJson
      if (stripped.refs.length > 0) {
        assetPlan.push({ sectionKey: raw.templateKey, subsectionKey: sub.subsectionKey, refs: stripped.refs })
      }
    }
    return {
      subsectionTemplateId: sub.id,
      subsectionKey: sub.subsectionKey,
      title: sub.title,
      offeringWebsite: sub.offeringWebsite,
      offeringVa: sub.offeringVa,
      offeringPpc: sub.offeringPpc,
      copyJson: sub.copyJson,
      contentJson,
      sortOrder: sub.sortOrder,
      fields: sub.fields
        .filter((f) => f.archivedAt === null)
        .map((f) => ({
          defKey: f.fieldKey,
          category: sub.subsectionKey,
          label: f.label,
          fieldType: f.fieldType,
          sortOrder: f.sortOrder,
          createdBy: 'seed' as const,
        })),
    }
  })

  return {
    section: {
      sectionKey: raw.templateKey,
      state: 'active',
      sectionTemplateId: raw.id,
      rendererType: raw.rendererType,
      title: raw.title,
      copyJson: raw.copyJson,
      contentJson: raw.contentJson,
      sortOrder: raw.sortOrder,
      templateVersion: raw.version,
      subsections,
    },
    assetPlan,
  }
}

/**
 * THE copy-on-create projection (spec §5): every ACTIVE template section with
 * ≥1 active subsection matching the enabled offerings, only matching
 * subsections, active fields as ViewbookField inputs. Section state preserves
 * today's createViewbook semantics exactly: 'assessment' starts 'hidden' for
 * kind 'new-build', 'active' otherwise (Codex fix #12).
 */
export function projectInstanceTree(
  raw: RawTemplateSection[],
  offerings: ViewbookOfferings,
  kind: 'new-build' | 'upgrade',
): { sections: SectionInstanceInput[]; assetPlan: AssetPlanEntry[] } {
  const sections: SectionInstanceInput[] = []
  const assetPlan: AssetPlanEntry[] = []
  for (const rawSection of raw) {
    const projected = projectSectionInstance(rawSection, offerings)
    if (!projected) continue
    const state =
      projected.section.sectionKey === 'assessment' && kind === 'new-build' ? 'hidden' : projected.section.state
    sections.push({ ...projected.section, state })
    assetPlan.push(...projected.assetPlan)
  }
  return { sections, assetPlan }
}

/** An offering is available iff ≥1 ACTIVE subsection under an ACTIVE section carries the tag (Codex fix #6). */
export function offeringAvailability(raw: RawTemplateSection[]): ViewbookOfferings {
  const availability = { website: false, va: false, ppc: false }
  for (const section of raw) {
    if (section.archivedAt !== null) continue
    for (const sub of section.subsections) {
      if (sub.archivedAt !== null) continue
      if (sub.offeringWebsite) availability.website = true
      if (sub.offeringVa) availability.va = true
      if (sub.offeringPpc) availability.ppc = true
    }
  }
  return availability
}

// ---- phase 2: best-effort asset snapshot (spec §5/§8) ----------------------

/**
 * Copy each planned global roster photo into the viewbook's own asset scope
 * and rewrite the owning subsection's contentJson (photo set by memberName) in
 * ONE array-form txn fenced on the subsection's version — the fence-sharing
 * bumps (owning section aggregate version + scoped syncVersion; the rewrite
 * changes rendered content, so an open tab must refetch) run BEFORE the
 * guarded update, house pattern. Fence loss → delete the newly-saved files +
 * logError. Missing/corrupt source file → that ref stays null + logError
 * (honest degrade). Never throws: each entry is fault-isolated.
 */
export async function snapshotInstanceAssets(viewbookId: number, plan: AssetPlanEntry[]): Promise<void> {
  const scope = String(viewbookId)
  for (const entry of plan) {
    const saved: string[] = []
    const ctx = {
      subsystem: 'viewbook',
      op: 'instance-asset-snapshot',
      viewbookId,
      sectionKey: entry.sectionKey,
      subsectionKey: entry.subsectionKey,
    }
    try {
      const sub = await prisma.viewbookSubsection.findFirst({
        where: { viewbookId, subsectionKey: entry.subsectionKey, section: { sectionKey: entry.sectionKey } },
        select: { id: true, sectionId: true, version: true, contentJson: true },
      })
      if (!sub || sub.contentJson === null) {
        logError(ctx, new Error('asset snapshot target subsection missing or contentless'))
        continue
      }
      let parsed: unknown = null
      try {
        parsed = JSON.parse(sub.contentJson)
      } catch {
        parsed = null
      }
      if (!isPlainObject(parsed) || parsed.v !== 1 || !Array.isArray(parsed.team)) {
        logError(ctx, new Error('asset snapshot target contentJson is not a roster envelope'))
        continue
      }

      const photoByMember = new Map<string, string>()
      for (const ref of entry.refs) {
        const source = await readViewbookAsset('global', ref.filename)
        if (source === null) {
          // Honest degrade: the member's photo stays null.
          logError({ ...ctx, filename: ref.filename }, new Error('asset snapshot source file missing'))
          continue
        }
        const { filename } = await saveViewbookAsset(scope, source.buf)
        saved.push(filename)
        photoByMember.set(ref.memberName, filename)
      }
      if (photoByMember.size === 0) continue

      const team = parsed.team.map((member) => {
        if (!isPlainObject(member) || typeof member.name !== 'string') return member
        const filename = photoByMember.get(member.name)
        return filename === undefined ? member : { ...member, photo: filename }
      })
      const nextContentJson = JSON.stringify({ ...parsed, team })

      const now = Date.now()
      const fence = Prisma.sql`EXISTS (
        SELECT 1 FROM "ViewbookSubsection" WHERE "id" = ${sub.id} AND "version" = ${sub.version}
      )`
      // Fence-sharing bumps BEFORE the guarded update that flips the fence
      // (sync.ts convention): a lost fence bumps nothing.
      const results = await prisma.$transaction([
        prisma.$executeRaw`UPDATE "ViewbookSection" SET "version" = "version" + 1, "updatedAt" = ${now} WHERE "id" = ${sub.sectionId} AND (${fence})`,
        syncVersionBumpWhere(viewbookId, fence),
        prisma.$executeRaw`UPDATE "ViewbookSubsection" SET "contentJson" = ${nextContentJson}, "version" = "version" + 1, "updatedAt" = ${now} WHERE "id" = ${sub.id} AND "version" = ${sub.version}`,
      ])
      if ((results[2] as number) === 0) {
        // Fence loss: a concurrent content write won — its contentJson is the
        // truth; retire the now-unreferenced new files.
        await deleteViewbookAssets(scope, saved)
        logError(ctx, new Error('asset snapshot lost the subsection version fence'))
      }
    } catch (err) {
      await deleteViewbookAssets(scope, saved)
      logError(ctx, err)
    }
  }
}
