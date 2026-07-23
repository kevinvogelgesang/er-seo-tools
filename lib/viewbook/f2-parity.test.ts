// F2 rendered-parity gate (Task 1 / Task 10). The branch tip is still
// identical to origin/main when this file is first committed — this test
// freezes PRE-F2 public-data behavior (legacy global-content/override tables)
// so the later instances-cutover (Task 9) can prove the rendered payload
// hasn't regressed.
//
// Two modes, one file:
//   F2_PARITY_CAPTURE=1 npx vitest run lib/viewbook/f2-parity.test.ts
//     — (re)writes the fixture from the current code's output.
//   npx vitest run lib/viewbook/f2-parity.test.ts
//     — asserts the current code's output still matches the committed fixture.
//
// Determinism: every ViewbookGlobalContent row is wiped before seeding fixed
// content (this worker's SQLite db is shared, in sequence, by every
// lib/viewbook/*.test.ts file — a prior file's leftover global content must
// never leak into this fixture) and the normalizer strips every remaining
// nondeterministic value (autoincrement ids, the viewbook token, ISO
// timestamps, and the one real per-run-random photo filename).
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import sharp from 'sharp'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates } from './template-seed'
import { createViewbook, deleteViewbook } from './service'
import { loadViewbookPublicData } from './public-data'
import { putGlobalContent, attachTeamPhoto } from './global-content'
import { putSectionCopyGlobal } from './section-copy-content'
import { normalizeParityPayload } from './__fixtures__/parity-normalize'
import fixture from './__fixtures__/f2-parity-public-data.json'

const CAPTURE = process.env.F2_PARITY_CAPTURE === '1'
const OPERATOR = 'parity@enrollmentresources.com'
const CLIENT_NAME_PREFIX = 'f2-parity-client'

let assetsDir: string

async function seedDeterministicContent(): Promise<void> {
  // Full reset — NOT a scoped delete — so this fixture's captured content
  // never depends on what an earlier lib/viewbook test file (sharing this
  // worker's db) left in ViewbookGlobalContent (mirrors global-content.test.ts's
  // own per-test wipe).
  await prisma.viewbookGlobalContent.deleteMany({})

  // Fixed 2-member roster: member 1 gets a real saved 'global'-scope photo
  // (via attachTeamPhoto -> saveViewbookAsset), member 2 stays photoless —
  // exercises both branches of the roster's photo rendering.
  await putGlobalContent(
    'team',
    [
      {
        name: 'Parity Member One',
        role: 'Client Success Manager',
        photo: null,
        blurb: 'Guides your viewbook through every stage.',
        isCsm: true,
      },
      {
        name: 'Parity Member Two',
        role: 'SEO Strategist',
        photo: null,
        blurb: 'Owns the technical SEO roadmap.',
      },
    ],
    OPERATOR,
  )
  const photo = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer()
  await attachTeamPhoto('Parity Member One', photo, OPERATOR)

  // Fixed process/why/seo-base blocks — the welcome + strategy section content.
  await putGlobalContent(
    'process',
    {
      blocks: [
        { heading: 'Discovery', body: 'We start with a discovery call to learn your goals.' },
        { heading: 'Build', body: 'Then we design and build the site together.' },
      ],
    },
    OPERATOR,
  )
  await putGlobalContent(
    'why',
    { blocks: [{ heading: 'Why Enrollment Resources', body: 'We specialize in education marketing.' }] },
    OPERATOR,
  )
  await putGlobalContent(
    'seo-base',
    { blocks: [{ heading: 'Technical SEO', body: 'We audit and fix crawlability, speed, and metadata issues.' }] },
    OPERATOR,
  )

  // A company-wide section-copy:welcome row so the payload exercises the
  // company-wide -> code-default precedence (no per-viewbook override exists).
  await putSectionCopyGlobal(
    'welcome',
    {
      purpose: 'Say hello and introduce your assigned team.',
      whatThis: 'A short welcome note plus your Enrollment Resources team.',
      whatWeNeed: 'Nothing yet — just read through.',
    },
    OPERATOR,
  )
}

async function buildPayload(kind: 'new-build' | 'upgrade') {
  const client = await prisma.client.create({ data: { name: `${CLIENT_NAME_PREFIX}-${kind}` } })
  const vb = await createViewbook(client.id, kind, OPERATOR)
  const data = await loadViewbookPublicData(vb.token)
  const normalized = normalizeParityPayload(data)
  await deleteViewbook(vb.id)
  await prisma.client.delete({ where: { id: client.id } })
  return normalized
}

describe('F2 rendered-parity gate', () => {
  beforeAll(async () => {
    assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-f2-parity-'))
    process.env.VIEWBOOK_ASSETS_DIR = assetsDir
    await seedViewbookTemplates()
    await seedDeterministicContent()
  })

  afterAll(async () => {
    delete process.env.VIEWBOOK_ASSETS_DIR
    await rm(assetsDir, { recursive: true, force: true })
    // Safety net (house convention, public-data.test.ts precedent): catches
    // any client left behind by a failed assertion mid-test.
    await prisma.client.deleteMany({ where: { name: { startsWith: CLIENT_NAME_PREFIX } } })
  })

  it('fresh-viewbook payload matches the pre-F2 fixture (both kinds)', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['new-build', 'upgrade'] as const) out[kind] = await buildPayload(kind)
    if (CAPTURE) {
      await writeFile('lib/viewbook/__fixtures__/f2-parity-public-data.json', JSON.stringify(out, null, 2) + '\n')
      return
    }
    expect(out).toEqual(fixture)
  })

  it('new-build assessment section is hidden, upgrade active (state pin — visibility is stage-gated later)', async () => {
    for (const kind of ['new-build', 'upgrade'] as const) {
      const client = await prisma.client.create({ data: { name: `${CLIENT_NAME_PREFIX}-${kind}` } })
      const vb = await createViewbook(client.id, kind, OPERATOR)
      const section = await prisma.viewbookSection.findUniqueOrThrow({
        where: { viewbookId_sectionKey: { viewbookId: vb.id, sectionKey: 'assessment' } },
        select: { state: true },
      })
      expect(section.state).toBe(kind === 'new-build' ? 'hidden' : 'active')
      await deleteViewbook(vb.id)
      await prisma.client.delete({ where: { id: client.id } })
    }
  })
})
