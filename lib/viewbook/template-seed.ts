// F1a template-library seeder (spec §5, Codex plan-fixes #5/#7/#13/#15).
//
// Two layers:
//  1. `projectTemplateSeedWithIssues` — a GENUINELY pure projection (fix #3):
//     no Date/Math.random/IO/logging. It turns the live global-content +
//     section-copy rows into the full 13-tree seed payload and returns any
//     corrupt/invalid source rows as DATA (`issues`), never logging them.
//     Shared by BOTH the seeder and the F1a parity tests (fix #15).
//  2. `seedViewbookTemplates` — the boot-time idempotent seeder. Each of the
//     13 sections is created as ONE atomic nested Prisma create (fix #5); the
//     seeder NEVER updates an existing row (operator edits win). P2002 is
//     resolved winner-based (re-read the templateKey), never via meta.target
//     (fix #4); any non-P2002 error propagates.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import {
  validateTeam,
  validateBlocks,
  validatePcIntro,
  PC_INTRO_DEFAULT,
} from './content-validators'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { SECTION_COPY } from './section-copy'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { CATALOG, CATALOG_CATEGORIES } from './catalog'
import { CATEGORY_LABELS } from './category-labels'
import { GLOBAL_CONTENT_KEYS, type ContentBlocks, type TeamMember } from './global-content-keys'
import { SECTION_KEYS, type SectionKey } from './theme'
import { sectionCopyKey } from './section-copy-content'

// §0 Kevin-confirmed canonical order (stage-journey; rationale spec §5).
// Exported for F3. sortOrder = (index + 1) * 10.
export const CANONICAL_SECTION_ORDER: readonly SectionKey[] = [
  'pc-intro',
  'pc-setup',
  'pc-invite',
  'data-source',
  'welcome',
  'milestones',
  'strategy',
  'kickoff-next',
  'ws-intro',
  'brand',
  'assessment',
  'materials',
  'pc-thanks',
] as const

export interface SeedFieldRow {
  fieldKey: string
  label: string
  fieldType: string
  sortOrder: number
}

export interface SeedSubsectionRow {
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copyJson: string | null
  contentJson: string | null
  sortOrder: number
  fields: SeedFieldRow[]
}

export interface SeedSectionTree {
  templateKey: SectionKey
  rendererType: string
  title: string
  copyJson: string
  contentJson: string | null
  sortOrder: number
  subsections: SeedSubsectionRow[]
}

export interface SeedSourceRow {
  key: string
  bodyJson: string
}

export interface SeedIssue {
  key: string
  reason: 'corrupt-json' | 'invalid-shape'
}

export interface SeedDeps {
  // Test barrier seam (Codex plan-fix #6): awaited AFTER findUnique-skip and
  // BEFORE createSeedTree so a test can rendezvous two concurrent runs.
  beforeCreate?: (templateKey: string) => Promise<void>
}

// ---- pure resolution helpers ----------------------------------------------

// Resolve one present-or-absent global body: absent → default (no issue);
// corrupt JSON → default + corrupt-json issue; parses-but-invalid → default +
// invalid-shape issue. Never logs; issues are returned data.
function resolveGlobalBody<T>(
  rows: SeedSourceRow[],
  key: string,
  validator: (v: unknown) => T | null,
  fallback: T,
  issues: SeedIssue[],
): T {
  const row = rows.find((r) => r.key === key)
  if (row === undefined) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(row.bodyJson)
  } catch {
    issues.push({ key, reason: 'corrupt-json' })
    return fallback
  }
  const validated = validator(parsed)
  if (validated === null) {
    issues.push({ key, reason: 'invalid-shape' })
    return fallback
  }
  return validated
}

// Section copy = `section-copy:<key>` row (validated) else the code default's
// 3-key projection (cta already gone per Task 4).
function resolveCopy(
  sectionCopyRows: SeedSourceRow[],
  key: SectionKey,
  issues: SeedIssue[],
): SectionCopyContent {
  const codeDefault: SectionCopyContent = {
    purpose: SECTION_COPY[key].purpose,
    whatThis: SECTION_COPY[key].whatThis,
    whatWeNeed: SECTION_COPY[key].whatWeNeed,
  }
  const storedKey = sectionCopyKey(key)
  const row = sectionCopyRows.find((r) => r.key === storedKey)
  if (row === undefined) return codeDefault
  let parsed: unknown
  try {
    parsed = JSON.parse(row.bodyJson)
  } catch {
    issues.push({ key: storedKey, reason: 'corrupt-json' })
    return codeDefault
  }
  const validated = validateSectionCopy(parsed)
  if (validated === null) {
    issues.push({ key: storedKey, reason: 'invalid-shape' })
    return codeDefault
  }
  return validated
}

const EMPTY_BLOCKS: ContentBlocks = { blocks: [] }

// Build the ONE 'main' subsection's contentJson for the content-bearing
// renderers; every other section's main subsection is contentless (null).
export function projectMainContentJson(
  key: SectionKey,
  globalRows: SeedSourceRow[],
  issues: SeedIssue[],
): string | null {
  switch (key) {
    case 'welcome': {
      const team = resolveGlobalBody<TeamMember[]>(globalRows, 'team', validateTeam, [], issues)
      const process = resolveGlobalBody<ContentBlocks>(globalRows, 'process', validateBlocks, EMPTY_BLOCKS, issues)
      const why = resolveGlobalBody<ContentBlocks>(globalRows, 'why', validateBlocks, EMPTY_BLOCKS, issues)
      return JSON.stringify({ v: 1, team, process, why })
    }
    case 'strategy': {
      const seoBase = resolveGlobalBody<ContentBlocks>(globalRows, 'seo-base', validateBlocks, EMPTY_BLOCKS, issues)
      const geoBase = resolveGlobalBody<ContentBlocks>(globalRows, 'geo-base', validateBlocks, EMPTY_BLOCKS, issues)
      const eeatBase = resolveGlobalBody<ContentBlocks>(globalRows, 'eeat-base', validateBlocks, EMPTY_BLOCKS, issues)
      return JSON.stringify({ v: 1, seoBase, geoBase, eeatBase })
    }
    case 'milestones': {
      const processMilestones = resolveGlobalBody<ContentBlocks>(
        globalRows, 'process-milestones', validateBlocks, EMPTY_BLOCKS, issues,
      )
      return JSON.stringify({ v: 1, processMilestones })
    }
    case 'pc-intro': {
      const intro = resolveGlobalBody<string>(globalRows, 'pc-intro', validatePcIntro, PC_INTRO_DEFAULT, issues)
      return JSON.stringify({ v: 1, intro })
    }
    default:
      return null
  }
}

function dataSourceSubsections(): SeedSubsectionRow[] {
  return CATALOG_CATEGORIES.map((category, i) => ({
    subsectionKey: category,
    title: CATEGORY_LABELS[category],
    offeringWebsite: true,
    offeringVa: false,
    offeringPpc: false,
    copyJson: null,
    contentJson: null,
    sortOrder: (i + 1) * 10,
    fields: CATALOG.filter((c) => c.category === category).map((c) => ({
      fieldKey: c.defKey,
      label: c.label,
      fieldType: c.fieldType,
      sortOrder: c.sortOrder,
    })),
  }))
}

// ---- the pure projection ---------------------------------------------------

export function projectTemplateSeedWithIssues(
  globalRows: SeedSourceRow[],
  sectionCopyRows: SeedSourceRow[],
): { trees: SeedSectionTree[]; issues: SeedIssue[] } {
  const issues: SeedIssue[] = []
  const trees = CANONICAL_SECTION_ORDER.map((key, index) => {
    const title = SECTION_TITLES[key]
    const copy = resolveCopy(sectionCopyRows, key, issues)
    const subsections: SeedSubsectionRow[] =
      key === 'data-source'
        ? dataSourceSubsections()
        : [
            {
              subsectionKey: 'main',
              title,
              offeringWebsite: true,
              offeringVa: false,
              offeringPpc: false,
              copyJson: null,
              contentJson: projectMainContentJson(key, globalRows, issues),
              sortOrder: 10,
              fields: [],
            },
          ]
    return {
      templateKey: key,
      rendererType: key,
      title,
      copyJson: JSON.stringify({ v: 1, copy }),
      contentJson: null,
      sortOrder: (index + 1) * 10,
      subsections,
    }
  })
  return { trees, issues }
}

export function projectTemplateSeed(
  globalRows: SeedSourceRow[],
  sectionCopyRows: SeedSourceRow[],
): SeedSectionTree[] {
  return projectTemplateSeedWithIssues(globalRows, sectionCopyRows).trees
}

// ---- the seeder ------------------------------------------------------------

// The ONE nested-create `data` object production uses (pure — exported for
// F1b's template-service caller). SectionTemplate + all subsections + all
// fields in a SINGLE statement, so a crash or a uniqueness violation can
// never leave a partial tree behind.
export function seedTreeCreateData(tree: SeedSectionTree): Prisma.SectionTemplateCreateInput {
  return {
    templateKey: tree.templateKey,
    rendererType: tree.rendererType,
    title: tree.title,
    copyJson: tree.copyJson,
    contentJson: tree.contentJson,
    sortOrder: tree.sortOrder,
    subsections: {
      create: tree.subsections.map((s) => ({
        subsectionKey: s.subsectionKey,
        title: s.title,
        offeringWebsite: s.offeringWebsite,
        offeringVa: s.offeringVa,
        offeringPpc: s.offeringPpc,
        copyJson: s.copyJson,
        contentJson: s.contentJson,
        sortOrder: s.sortOrder,
        fields: {
          create: s.fields.map((f) => ({
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            sortOrder: f.sortOrder,
          })),
        },
      })),
    },
  }
}

// Exported for the atomicity test.
export async function createSeedTree(tree: SeedSectionTree): Promise<void> {
  await prisma.sectionTemplate.create({ data: seedTreeCreateData(tree) })
}

export async function seedViewbookTemplates(deps: SeedDeps = {}): Promise<void> {
  const [globalRows, sectionCopyRows] = await Promise.all([
    prisma.viewbookGlobalContent.findMany({
      where: { key: { in: [...GLOBAL_CONTENT_KEYS] } },
      select: { key: true, bodyJson: true },
    }),
    prisma.viewbookGlobalContent.findMany({
      where: { key: { in: SECTION_KEYS.map(sectionCopyKey) } },
      select: { key: true, bodyJson: true },
    }),
  ])

  const { trees, issues } = projectTemplateSeedWithIssues(globalRows, sectionCopyRows)
  for (const issue of issues) {
    logError(
      { subsystem: 'viewbook', op: 'template-seed', key: issue.key, reason: issue.reason },
      new Error(`viewbook seed source ${issue.reason}: ${issue.key}`),
    )
  }

  for (const tree of trees) {
    const existing = await prisma.sectionTemplate.findUnique({
      where: { templateKey: tree.templateKey },
      select: { id: true },
    })
    if (existing) continue // operator edits win — the seeder NEVER updates

    await deps.beforeCreate?.(tree.templateKey)

    try {
      await createSeedTree(tree)
    } catch (err) {
      // Winner-based resolution (fix #4) — NEVER inspect meta.target.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma.sectionTemplate.findUnique({
          where: { templateKey: tree.templateKey },
          select: { id: true },
        })
        if (winner) continue // concurrent seed won the race — fine
        // No winner → a nested uniqueness defect (e.g. a global fieldKey
        // collision with a pre-existing row). Log + skip this section only.
        logError({ subsystem: 'viewbook', op: 'template-seed', templateKey: tree.templateKey }, err)
        continue
      }
      // Any non-P2002 error is infrastructure — propagate, never a silent
      // partial "success" (fix #4).
      throw err
    }
  }
}
