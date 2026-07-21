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

export interface SectionCopyContent {
  purpose: string
  whatThis: string
  whatWeNeed: string | null
}
export type ResolvedSectionCopy = SectionCopyContent

const CAPS = { purpose: 240, whatThis: 600, whatWeNeed: 600 }
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function validateSectionCopy(raw: unknown): SectionCopyContent | null {
  if (!isPlainObject(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 3) return null
  const { purpose, whatThis, whatWeNeed } = raw
  if (typeof purpose !== 'string' || purpose.trim().length === 0 || purpose.length > CAPS.purpose) return null
  if (typeof whatThis !== 'string' || whatThis.trim().length === 0 || whatThis.length > CAPS.whatThis) return null
  if (whatWeNeed !== null && typeof whatWeNeed !== 'string') return null
  if (typeof whatWeNeed === 'string' && whatWeNeed.length > CAPS.whatWeNeed) return null
  const normalizedNeed = typeof whatWeNeed === 'string' && whatWeNeed.trim().length > 0 ? whatWeNeed : null
  return { purpose, whatThis, whatWeNeed: normalizedNeed }
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
export async function putSectionCopyGlobal(sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const key = sectionCopyKey(sectionKey)
  const bodyJson = JSON.stringify(validated)
  await prisma.$transaction([
    prisma.viewbookGlobalContent.upsert({
      where: { key },
      update: { bodyJson, updatedBy },
      create: { key, bodyJson, updatedBy },
    }),
    syncVersionBumpAllStatement(),
  ])
}

export async function deleteSectionCopyGlobal(sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const key = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookGlobalContent" WHERE "key" = ${key})`
  const [, res] = await prisma.$transaction([
    syncVersionBumpAllWhere(fence),
    prisma.viewbookGlobalContent.deleteMany({ where: { key } }),
  ])
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
