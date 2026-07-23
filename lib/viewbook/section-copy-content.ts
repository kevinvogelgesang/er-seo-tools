// Company-wide + per-viewbook section copy (spec Feature A). Reuses the
// existing ViewbookGlobalContent / ViewbookContentOverride tables under a
// reserved `section-copy:<sectionKey>` key namespace — NO migration. Mirrors
// lib/viewbook/global-content.ts conventions: strict whole-doc validation
// (read exactly as strict as write; corrupt rows read null, never throw);
// every write bumps syncVersion inside the same $transaction. Server-only.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { SECTION_KEYS, type SectionKey } from './theme'
import { SECTION_COPY } from './section-copy'
import {
  syncVersionBumpAllStatement, syncVersionBumpAllWhere,
  syncVersionBumpStatement, syncVersionBumpWhere,
} from './sync'
import {
  type SectionCopyContent,
  type ResolvedSectionCopy,
  CAPS,
  validateSectionCopy,
} from './section-copy-validator'

export type { SectionCopyContent, ResolvedSectionCopy }
export { CAPS, validateSectionCopy }

const NS = 'section-copy:'

export function sectionCopyKey(sectionKey: SectionKey): string {
  return `${NS}${sectionKey}`
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(key)
}

// Suffix-validate a stored key back to a SectionKey (null if off-catalog).
function sectionKeyFromStored(key: string): SectionKey | null {
  if (!key.startsWith(NS)) return null
  const suffix = key.slice(NS.length)
  return isSectionKey(suffix) ? suffix : null
}

// Whole-object per layer: per-viewbook override ← company-wide ← code default.
// Each layer already `validateSectionCopy`-filtered to null-on-invalid by the
// caller, so an invalid override arrives here as null and falls through.
export function resolveSectionCopy(
  sectionKey: SectionKey,
  companyWide: SectionCopyContent | null,
  override: SectionCopyContent | null,
): ResolvedSectionCopy {
  if (override) return override
  if (companyWide) return companyWide
  const code = SECTION_COPY[sectionKey]
  return { purpose: code.purpose, whatThis: code.whatThis, whatWeNeed: code.whatWeNeed }
}

function parseRow(bodyJson: string): SectionCopyContent | null {
  try { return validateSectionCopy(JSON.parse(bodyJson)) } catch { return null }
}

// ---- reads (one findMany each, exact key set — never startsWith) ----------
export async function getSectionCopyGlobalMap(): Promise<Partial<Record<SectionKey, SectionCopyContent>>> {
  const rows = await prisma.viewbookGlobalContent.findMany({
    where: { key: { in: SECTION_KEYS.map(sectionCopyKey) } },
  })
  const out: Partial<Record<SectionKey, SectionCopyContent>> = {}
  for (const r of rows) {
    const sk = sectionKeyFromStored(r.key)
    if (!sk) continue
    const v = parseRow(r.bodyJson)
    if (v) out[sk] = v
  }
  return out
}

export async function getSectionCopyOverrideMap(viewbookId: number): Promise<Partial<Record<SectionKey, SectionCopyContent>>> {
  const rows = await prisma.viewbookContentOverride.findMany({
    where: { viewbookId, contentKey: { in: SECTION_KEYS.map(sectionCopyKey) } },
  })
  const out: Partial<Record<SectionKey, SectionCopyContent>> = {}
  for (const r of rows) {
    const sk = sectionKeyFromStored(r.contentKey)
    if (!sk) continue
    const v = parseRow(r.body)
    if (v) out[sk] = v
  }
  return out
}

// ---- writes (bump inside the same txn; delete = EXISTS-fenced, 404 on 0) ---

// Named composable pieces (Codex plan-fix #1: F1b's template-service caller
// interleaves template statements between these; an opaque array can't be
// re-ordered). Callers compose `[legacyWrite, syncBump]` (write) or
// `[syncBump, ...templateStatements, deleteStmt]` (delete, fence-shared) in
// their own $transaction.
export function putSectionCopyGlobalStatements(sectionKey: SectionKey, validated: SectionCopyContent, updatedBy: string) {
  const key = sectionCopyKey(sectionKey)
  const bodyJson = JSON.stringify(validated)
  return {
    legacyWrite: prisma.viewbookGlobalContent.upsert({
      where: { key },
      update: { bodyJson, updatedBy },
      create: { key, bodyJson, updatedBy },
    }),
    syncBump: syncVersionBumpAllStatement(),
  }
}

export function deleteSectionCopyGlobalStatements(sectionKey: SectionKey) {
  const key = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookGlobalContent" WHERE "key" = ${key})`
  return {
    fence,
    syncBump: syncVersionBumpAllWhere(fence),
    deleteStmt: prisma.viewbookGlobalContent.deleteMany({ where: { key } }),
  }
}

export async function putSectionCopyGlobal(sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const { legacyWrite, syncBump } = putSectionCopyGlobalStatements(sectionKey, validated, updatedBy)
  await prisma.$transaction([legacyWrite, syncBump])
}

export async function deleteSectionCopyGlobal(sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const { syncBump, deleteStmt } = deleteSectionCopyGlobalStatements(sectionKey)
  const [, res] = await prisma.$transaction([syncBump, deleteStmt])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}

export async function putSectionCopyOverride(viewbookId: number, sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const contentKey = sectionCopyKey(sectionKey)
  const body = JSON.stringify(validated)
  await prisma.$transaction([
    prisma.viewbookContentOverride.upsert({
      where: { viewbookId_contentKey: { viewbookId, contentKey } },
      update: { body, updatedBy },
      create: { viewbookId, contentKey, body, updatedBy },
    }),
    syncVersionBumpStatement(viewbookId),
  ])
}

export async function deleteSectionCopyOverride(viewbookId: number, sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const contentKey = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookContentOverride" WHERE "viewbookId" = ${viewbookId} AND "contentKey" = ${contentKey}
  )`
  const [, res] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, fence),
    prisma.viewbookContentOverride.deleteMany({ where: { viewbookId, contentKey } }),
  ])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}
