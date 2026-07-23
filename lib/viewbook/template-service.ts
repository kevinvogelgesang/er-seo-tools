// THE single dual-write authority (spec §7 fixes #2/#3). Deleted whole in F2.
//
// getTemplateTree = the tree read (F1a's SectionTemplate/SubsectionTemplate/
// FieldTemplate rows decoded into typed views, corrupt columns degrading to
// null + a logged signal — never thrown). patchSectionTemplate = the ONE
// section-level write: a title-only edit touches only SectionTemplate, but a
// copy edit ALSO dual-writes the legacy `section-copy:<key>` global-content
// row inside the SAME array-form $transaction (Codex plan-fix #2/#3) — the
// throwing extendedWhereUnique guard is placed FIRST so a stale version rolls
// back BOTH sides (precedent: lib/viewbook/service.ts:397). syncVersion policy
// (plan decision D-e): a bridged copy write bumps every viewbook's
// syncVersion (via putSectionCopyGlobalStatements' syncBump); a title-only
// edit has no legacy statement and bumps nothing. reorderSections is an
// all-or-nothing sortOrder swap under the same guard-per-row shape. Array-form
// $transaction([...]) only — NEVER interactive $transaction(async tx => ...).
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import {
  parseTemplateCopy,
  parseSubsectionContent,
  parseSubsectionCopy,
  type SubsectionContentV1,
} from './template-content'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { putSectionCopyGlobalStatements } from './section-copy-content'
import { SECTION_KEYS, type SectionKey } from './theme'
import { CATALOG_CATEGORIES } from './catalog'
import type { GlobalContentKey } from './global-content-keys'

// The four bridged (templateKey, 'main') content pairs and their legacy keys.
export const BRIDGED_CONTENT: Record<string, { parts: Record<string, GlobalContentKey> }> = {
  welcome: { parts: { team: 'team', process: 'process', why: 'why' } },
  strategy: { parts: { seoBase: 'seo-base', geoBase: 'geo-base', eeatBase: 'eeat-base' } },
  milestones: { parts: { processMilestones: 'process-milestones' } },
  'pc-intro': { parts: { intro: 'pc-intro' } },
}
export type ContentKind = 'welcome' | 'strategy' | 'milestones' | 'pc-intro' | 'generic' | 'none'

export interface TemplateFieldView {
  id: number
  fieldKey: string
  label: string
  fieldType: string
  sortOrder: number
  version: number
  archivedAt: string | null
}
export interface TemplateSubsectionView {
  id: number
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copy: { intro: string | null; whatWeNeed: string | null } | null
  content: SubsectionContentV1 | null // decoded; null when absent OR corrupt
  contentKind: ContentKind
  sortOrder: number
  version: number
  archivedAt: string | null
  fields: TemplateFieldView[]
}
export interface TemplateSectionView {
  id: number
  templateKey: string
  rendererType: string
  title: string
  copy: SectionCopyContent | null // decoded from copyJson; null = corrupt (UI shows a warning, not a form)
  sortOrder: number
  version: number
  archivedAt: string | null
  subsections: TemplateSubsectionView[]
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)
const CATALOG_CATEGORY_SET: ReadonlySet<string> = new Set(CATALOG_CATEGORIES)

// contentKind rule (plan decision D-b): the ONE 'main' subsection of a
// bridged renderer carries that renderer's kind; every other seeded 'main'
// (a content-less renderer like brand/materials/etc.) is 'none'; the
// data-source category subsections (keyed by CATALOG_CATEGORIES, never
// 'main') are also 'none' (they hold FieldTemplate rows, not free content);
// anything else — an F2 operator-created subsection — is 'generic'.
function contentKindFor(templateKey: string, subsectionKey: string): ContentKind {
  if (subsectionKey === 'main') {
    return Object.prototype.hasOwnProperty.call(BRIDGED_CONTENT, templateKey)
      ? (templateKey as ContentKind)
      : 'none'
  }
  return CATALOG_CATEGORY_SET.has(subsectionKey) ? 'none' : 'generic'
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(key)
}

function isP2025(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export async function getTemplateTree(): Promise<{ sections: TemplateSectionView[] }> {
  const rows = await prisma.sectionTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      subsections: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          fields: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  })

  const sections: TemplateSectionView[] = rows.map((section) => {
    const parsedCopy = parseTemplateCopy(section.copyJson)
    if (parsedCopy === null) {
      // copyJson is NOT NULL on this model — a null parse is always corrupt,
      // never a legitimate "absent" state.
      logError(
        { subsystem: 'viewbook', op: 'template-tree-copy', templateKey: section.templateKey },
        new Error(`corrupt SectionTemplate.copyJson: ${section.templateKey}`),
      )
    }

    return {
      id: section.id,
      templateKey: section.templateKey,
      rendererType: section.rendererType,
      title: section.title,
      copy: parsedCopy?.copy ?? null,
      sortOrder: section.sortOrder,
      version: section.version,
      archivedAt: iso(section.archivedAt),
      subsections: section.subsections.map((sub) => {
        const parsedSubCopy = sub.copyJson !== null ? parseSubsectionCopy(sub.copyJson) : null
        if (sub.copyJson !== null && parsedSubCopy === null) {
          logError(
            {
              subsystem: 'viewbook',
              op: 'template-tree-subsection-copy',
              templateKey: section.templateKey,
              subsectionKey: sub.subsectionKey,
            },
            new Error(`corrupt SubsectionTemplate.copyJson: ${section.templateKey}/${sub.subsectionKey}`),
          )
        }

        // Bridged content lives on the 'main' subsection under the section's
        // OWN rendererType; every other subsection (data-source categories,
        // future F2 operator-created ones) uses the 'generic' shape — content
        // is null for the category rows anyway, so the choice is immaterial there.
        const contentRendererType = sub.subsectionKey === 'main' ? section.rendererType : 'generic'
        const parsedContent = parseSubsectionContent(contentRendererType, sub.contentJson)
        if (sub.contentJson !== null && parsedContent === null) {
          logError(
            {
              subsystem: 'viewbook',
              op: 'template-tree-subsection-content',
              templateKey: section.templateKey,
              subsectionKey: sub.subsectionKey,
            },
            new Error(`corrupt SubsectionTemplate.contentJson: ${section.templateKey}/${sub.subsectionKey}`),
          )
        }

        return {
          id: sub.id,
          subsectionKey: sub.subsectionKey,
          title: sub.title,
          offeringWebsite: sub.offeringWebsite,
          offeringVa: sub.offeringVa,
          offeringPpc: sub.offeringPpc,
          copy: parsedSubCopy?.copy ?? null,
          content: parsedContent,
          contentKind: contentKindFor(section.templateKey, sub.subsectionKey),
          sortOrder: sub.sortOrder,
          version: sub.version,
          archivedAt: iso(sub.archivedAt),
          fields: sub.fields.map((f) => ({
            id: f.id,
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            sortOrder: f.sortOrder,
            version: f.version,
            archivedAt: iso(f.archivedAt),
          })),
        }
      }),
    }
  })

  return { sections }
}

export async function patchSectionTemplate(
  sectionId: number,
  input: { version: number; title?: string; copy?: unknown },
  updatedBy: string,
): Promise<void> {
  if (input.title === undefined && input.copy === undefined) {
    throw new HttpError(400, 'invalid_content')
  }
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
      throw new HttpError(400, 'invalid_content')
    }
  }

  const existing = await prisma.sectionTemplate.findUnique({
    where: { id: sectionId },
    select: { templateKey: true },
  })
  if (!existing) throw new HttpError(404, 'not_found')

  let validatedCopy: SectionCopyContent | null = null
  if (input.copy !== undefined) {
    validatedCopy = validateSectionCopy(input.copy)
    if (validatedCopy === null) throw new HttpError(400, 'invalid_content')
    if (!isSectionKey(existing.templateKey)) {
      // The fixed F1a catalog (13 canonical keys) is the only bridge target —
      // a templateKey off that catalog (never produced today) has no legacy
      // section-copy home to dual-write.
      throw new HttpError(400, 'invalid_content')
    }
  }

  const guardedTemplateWrite = prisma.sectionTemplate.update({
    // extendedWhereUnique filter — P2025 on stale (precedent: lib/viewbook/service.ts:397)
    where: { id: sectionId, version: input.version },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(validatedCopy ? { copyJson: JSON.stringify({ v: 1, copy: validatedCopy }) } : {}),
      version: { increment: 1 },
    },
  })

  const statements: Prisma.PrismaPromise<unknown>[] = validatedCopy
    ? (({ legacyWrite, syncBump }) => [guardedTemplateWrite, legacyWrite, syncBump])(
        putSectionCopyGlobalStatements(existing.templateKey as SectionKey, validatedCopy, updatedBy),
      )
    : [guardedTemplateWrite] // title-only: no legacy statement, no syncVersion bump (D-e)

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}

export async function reorderSections(
  items: Array<{ id: number; version: number; sortOrder: number }>,
): Promise<void> {
  if (items.length === 0) throw new HttpError(400, 'invalid_content')
  const seen = new Set<number>()
  for (const item of items) {
    if (!Number.isInteger(item.id) || !Number.isInteger(item.version) || !Number.isInteger(item.sortOrder)) {
      throw new HttpError(400, 'invalid_content')
    }
    if (seen.has(item.id)) throw new HttpError(400, 'invalid_content')
    seen.add(item.id)
  }

  const statements = items.map((item) =>
    prisma.sectionTemplate.update({
      where: { id: item.id, version: item.version },
      data: { sortOrder: item.sortOrder, version: { increment: 1 } },
    }),
  )

  try {
    await prisma.$transaction(statements)
  } catch (err) {
    if (isP2025(err)) throw new HttpError(409, 'version_conflict')
    throw err
  }
}
