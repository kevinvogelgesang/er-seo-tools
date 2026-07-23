// F2 shared test-fixture helpers (Task 3). The instance cutover made several
// ViewbookSection columns NOT NULL (rendererType/title/copyJson/sortOrder/
// templateVersion) and gave ViewbookField a required subsectionId — every
// direct-Prisma fixture routes through THIS module so future schema drift is
// a one-file repair, never a suite-wide grep.
//
// Test-only: imported by *.test.ts files exclusively.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates } from '../template-seed'

/**
 * Section-instance create fragment for `sections: { create: [...] }` under a
 * Viewbook create (or a bare viewbookSection.create with viewbookId supplied
 * via overrides). Defaults satisfy every F2 NOT NULL instance column.
 */
export function mkSectionInput(
  key: string,
  overrides: Partial<Prisma.ViewbookSectionCreateWithoutViewbookInput> = {},
): Prisma.ViewbookSectionCreateWithoutViewbookInput {
  return {
    sectionKey: key,
    rendererType: key,
    title: `Test ${key}`,
    copyJson: JSON.stringify({ v: 1, copy: { purpose: `Purpose ${key}`, whatThis: `What ${key}`, whatWeNeed: null } }),
    sortOrder: 10,
    templateVersion: 1,
    ...overrides,
  }
}

/**
 * Subsection-instance create fragment (nested under a section create). The
 * generated 5.22 input types demand the redundant `viewbook` relation on
 * nested composite creates — runtime populates both shared scalars from the
 * parents (verified) — so callers cast at the prisma call site.
 */
export function mkSubsectionInput(
  key: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    subsectionKey: key,
    title: `Test ${key}`,
    offeringWebsite: true,
    sortOrder: 10,
    ...overrides,
  }
}

/**
 * Field create fragment. F2 made `subsectionId` required — direct
 * `viewbookField.create` fixtures must supply `viewbookId` AND `subsectionId`
 * via overrides (resolve one with `dataSourceSubsectionId`).
 */
export function mkFieldInput(
  defKey: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    defKey,
    category: 'school',
    label: defKey === null ? 'Custom question' : `Field ${defKey}`,
    fieldType: 'text',
    sortOrder: 999,
    createdBy: 'seed',
    ...overrides,
  }
}

/**
 * Resolve the seeded data-source subsection instance owning `category` inside
 * a viewbook created via createViewbook (subsectionKey === category by the
 * catalog seed contract).
 */
export async function dataSourceSubsectionId(viewbookId: number, category: string): Promise<number> {
  const sub = await prisma.viewbookSubsection.findFirstOrThrow({
    where: { viewbookId, subsectionKey: category },
    select: { id: true },
  })
  return sub.id
}

/**
 * F2 createViewbook snapshots from the template library — a test file that
 * creates viewbooks MUST have the 13/20/35 tree present (an empty library is
 * a 409 offering_unavailable). Idempotent (skips existing trees); call it in
 * beforeAll.
 */
export async function ensureSeededTemplates(): Promise<void> {
  await seedViewbookTemplates()
}
