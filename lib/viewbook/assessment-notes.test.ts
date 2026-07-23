import crypto from 'crypto'
import path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it, beforeAll } from 'vitest'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { prisma } from '@/lib/db'
import { readViewbookAsset } from './assets'
import { createViewbook } from './service'
import {
  addAssessmentImage,
  collectAssessmentImageSnapshot,
  deleteAssessmentImage,
  loadAssessmentNotes,
  setAssessmentNote,
} from './assessment-notes'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const PREFIX = 'vb-assess-'
let assetsDir: string

beforeEach(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), PREFIX))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
})

afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(assetsDir, { recursive: true, force: true })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function ownViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const vb = await createViewbook(client.id, 'upgrade', `${PREFIX}test`)
  return { ...vb, clientId: client.id }
}

async function archiveClient(clientId: number) {
  await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('setAssessmentNote / loadAssessmentNotes', () => {
  it('round-trips and re-sanitizes on read', async () => {
    const { id } = await ownViewbook()
    await setAssessmentNote(id, 'general', '<p>General <script>alert(1)</script>notes</p>', 'op@er.com')

    const notes = await loadAssessmentNotes(id)
    expect(notes?.generalNotesHtml).toBe('<p>General notes</p>')
    expect(notes?.userBehaviourHtml).toBeNull()
    expect(notes?.userBehaviourImages).toEqual([])
  })

  it('updates the same row on a second write to a different field', async () => {
    const { id } = await ownViewbook()
    await setAssessmentNote(id, 'general', '<p>General</p>', 'op@er.com')
    await setAssessmentNote(id, 'userBehaviour', '<p>Behaviour</p>', 'op@er.com')

    const notes = await loadAssessmentNotes(id)
    expect(notes?.generalNotesHtml).toBe('<p>General</p>')
    expect(notes?.userBehaviourHtml).toBe('<p>Behaviour</p>')

    const rowCount = await prisma.viewbookAssessmentContent.count({ where: { viewbookId: id } })
    expect(rowCount).toBe(1)
  })

  it('bumps syncVersion on write', async () => {
    const { id } = await ownViewbook()
    const before = await syncVersion(id)
    await setAssessmentNote(id, 'general', '<p>x</p>', 'op@er.com')
    expect(await syncVersion(id)).toBe(before + 1)
  })

  it('rejects a non-string html value', async () => {
    const { id } = await ownViewbook()
    // @ts-expect-error deliberately wrong runtime type
    await expect(setAssessmentNote(id, 'general', 123, 'op@er.com')).rejects.toMatchObject({ status: 400 })
  })

  it('404s on a missing viewbook', async () => {
    await expect(setAssessmentNote(999_999_999, 'general', '<p>x</p>', 'op@er.com')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('409s when the client is archived', async () => {
    const { id, clientId } = await ownViewbook()
    await archiveClient(clientId)
    await expect(setAssessmentNote(id, 'general', '<p>x</p>', 'op@er.com')).rejects.toMatchObject({ status: 409 })
    expect(await loadAssessmentNotes(id)).toBeNull()
  })

  it('closes the TOCTOU: an archive that lands after the upfront check still no-ops the write (not a silent success)', async () => {
    // The upfront `assertViewbookActive` check passes (client is active at
    // call time); `beforeWrite` then archives the client in the gap before
    // the guarded transaction runs. If the domain write were only fenced by
    // the upfront check (the bug this fixes), the note would land with a
    // stale syncVersion and the caller would see success. Fenced correctly,
    // the raw-SQL guard makes the write itself no-op and the call throws.
    const { id, clientId } = await ownViewbook()
    const before = await syncVersion(id)

    await expect(
      setAssessmentNote(id, 'general', '<p>raced</p>', 'op@er.com', {
        beforeWrite: async () => {
          await archiveClient(clientId)
        },
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(await loadAssessmentNotes(id)).toBeNull()
    expect(await syncVersion(id)).toBe(before)
  })

  it('returns null for a viewbook with no content row yet', async () => {
    const { id } = await ownViewbook()
    expect(await loadAssessmentNotes(id)).toBeNull()
  })

  // codex-review P2: a cleared contentEditable region sanitizes to
  // break-only markup (`<br />`, `<p><br /></p>`), not `''`. Without
  // write-time normalization, that markup would round-trip through
  // `hasHtml`'s naive `.trim().length > 0` check as "populated" and leak
  // an empty "General notes"/"User Behaviour" heading on the public page.
  it.each(['<br>', '<div><br></div>', '<p></p>', '   '])(
    'normalizes break-only/empty input %j to a stored empty string',
    async (breakOnly) => {
      const { id } = await ownViewbook()
      await setAssessmentNote(id, 'general', breakOnly, 'op@er.com')

      const raw = await prisma.viewbookAssessmentContent.findUniqueOrThrow({ where: { viewbookId: id } })
      expect(raw.generalNotesHtml).toBe('')

      const notes = await loadAssessmentNotes(id)
      expect(notes?.generalNotesHtml).toBe('')
    },
  )

  it('still persists a real note intact alongside the break-only normalization', async () => {
    const { id } = await ownViewbook()
    await setAssessmentNote(id, 'general', '<p>Real content here.</p>', 'op@er.com')

    const raw = await prisma.viewbookAssessmentContent.findUniqueOrThrow({ where: { viewbookId: id } })
    expect(raw.generalNotesHtml).toBe('<p>Real content here.</p>')

    const notes = await loadAssessmentNotes(id)
    expect(notes?.generalNotesHtml).toBe('<p>Real content here.</p>')
  })

  it('overwrites a previously real note with break-only input back to empty', async () => {
    const { id } = await ownViewbook()
    await setAssessmentNote(id, 'general', '<p>Will be cleared.</p>', 'op@er.com')
    await setAssessmentNote(id, 'general', '<div><br></div>', 'op@er.com')

    const notes = await loadAssessmentNotes(id)
    expect(notes?.generalNotesHtml).toBe('')
  })
})

describe('addAssessmentImage / deleteAssessmentImage', () => {
  it('nested-creates the content row + first image and bumps syncVersion', async () => {
    const { id } = await ownViewbook()
    const before = await syncVersion(id)

    const { filename } = await addAssessmentImage(id, PNG_1PX, 'op@er.com')

    expect(await syncVersion(id)).toBe(before + 1)
    const notes = await loadAssessmentNotes(id)
    expect(notes?.userBehaviourImages).toEqual([{ id: expect.any(Number), filename, sortOrder: 1 }])
    expect(await readViewbookAsset(String(id), filename)).not.toBeNull()
  })

  it('appends subsequent images in ascending sortOrder', async () => {
    const { id } = await ownViewbook()
    const first = await addAssessmentImage(id, PNG_1PX, 'op@er.com')
    const second = await addAssessmentImage(id, PNG_1PX, 'op@er.com')

    const notes = await loadAssessmentNotes(id)
    expect(notes?.userBehaviourImages.map((img) => img.filename)).toEqual([first.filename, second.filename])
    expect(notes?.userBehaviourImages.map((img) => img.sortOrder)).toEqual([1, 2])

    const rowCount = await prisma.viewbookAssessmentContent.count({ where: { viewbookId: id } })
    expect(rowCount).toBe(1)
  })

  it('deterministic order is sortOrder-asc then id-asc for ties', async () => {
    const { id } = await ownViewbook()
    const a = await addAssessmentImage(id, PNG_1PX, 'op@er.com')
    const b = await addAssessmentImage(id, PNG_1PX, 'op@er.com')

    const content = await prisma.viewbookAssessmentContent.findUniqueOrThrow({ where: { viewbookId: id } })
    // Force a tie on sortOrder to prove the id tiebreaker is applied.
    await prisma.viewbookAssessmentImage.updateMany({
      where: { contentId: content.id },
      data: { sortOrder: 1 },
    })

    const notes = await loadAssessmentNotes(id)
    const aId = (await prisma.viewbookAssessmentImage.findFirstOrThrow({ where: { filename: a.filename } })).id
    const bId = (await prisma.viewbookAssessmentImage.findFirstOrThrow({ where: { filename: b.filename } })).id
    const expectedOrder = aId < bId ? [a.filename, b.filename] : [b.filename, a.filename]
    expect(notes?.userBehaviourImages.map((img) => img.filename)).toEqual(expectedOrder)
  })

  it('404s on a missing viewbook before any file is written', async () => {
    await expect(addAssessmentImage(999_999_999, PNG_1PX, 'op@er.com')).rejects.toMatchObject({ status: 404 })
    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((entry) => String(entry).endsWith('.webp'))).toHaveLength(0)
  })

  it('cleans up the written file when the DB write fails AFTER the file is already saved', async () => {
    // The old version of this test called addAssessmentImage(999_999_999, …),
    // which 404s at the upfront `assertViewbookActive` check BEFORE
    // saveViewbookAsset ever runs — no file is written, so the catch-block
    // cleanup path is never exercised; the test passed even with the
    // `deleteViewbookAssets` call deleted. This version proves the REAL
    // post-file-write failure path: the upfront check passes (the viewbook
    // is valid and active), the file gets written to disk, and only THEN
    // does `beforeWrite` archive the client — landing the race in the gap
    // the guarded raw-SQL INSERT closes. The image insert affects zero rows,
    // the function throws 409, and the catch block must delete the
    // already-saved file. Removing the `deleteViewbookAssets(scope,
    // [filename])` call in the catch (or removing the imageInsertCount===0
    // throw) leaves the orphaned .webp file on disk and this test fails.
    const { id, clientId } = await ownViewbook()

    await expect(
      addAssessmentImage(id, PNG_1PX, 'op@er.com', {
        beforeWrite: async () => {
          await archiveClient(clientId)
        },
      }),
    ).rejects.toMatchObject({ status: 409 })

    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((entry) => String(entry).endsWith('.webp'))).toHaveLength(0)
    expect(await loadAssessmentNotes(id)).toBeNull()
  })

  it('409s and writes no file when the client is archived', async () => {
    const { id, clientId } = await ownViewbook()
    await archiveClient(clientId)
    await expect(addAssessmentImage(id, PNG_1PX, 'op@er.com')).rejects.toMatchObject({ status: 409 })
    const entries = await readdir(assetsDir, { recursive: true }).catch(() => [])
    expect((entries as string[]).filter((entry) => String(entry).endsWith('.webp'))).toHaveLength(0)
  })

  it('deletes the row, the file, and bumps syncVersion', async () => {
    const { id } = await ownViewbook()
    const { filename } = await addAssessmentImage(id, PNG_1PX, 'op@er.com')
    const notes = await loadAssessmentNotes(id)
    const imageId = notes!.userBehaviourImages[0].id

    const before = await syncVersion(id)
    await deleteAssessmentImage(id, imageId, 'op@er.com')

    expect(await syncVersion(id)).toBe(before + 1)
    expect(await loadAssessmentNotes(id)).toMatchObject({ userBehaviourImages: [] })
    expect(await readViewbookAsset(String(id), filename)).toBeNull()
  })

  it('404s deleting a cross-viewbook image and bumps nothing', async () => {
    const owner = await ownViewbook()
    const other = await ownViewbook()
    const { filename } = await addAssessmentImage(owner.id, PNG_1PX, 'op@er.com')
    const notes = await loadAssessmentNotes(owner.id)
    const imageId = notes!.userBehaviourImages[0].id

    const before = await syncVersion(other.id)
    await expect(deleteAssessmentImage(other.id, imageId, 'op@er.com')).rejects.toMatchObject({ status: 404 })
    expect(await syncVersion(other.id)).toBe(before)
    expect(await readViewbookAsset(String(owner.id), filename)).not.toBeNull()
  })

  it('404s deleting from an archived-client viewbook and leaves the file in place', async () => {
    const { id, clientId } = await ownViewbook()
    const { filename } = await addAssessmentImage(id, PNG_1PX, 'op@er.com')
    const notes = await loadAssessmentNotes(id)
    const imageId = notes!.userBehaviourImages[0].id

    await archiveClient(clientId)
    await expect(deleteAssessmentImage(id, imageId, 'op@er.com')).rejects.toMatchObject({ status: 404 })
    expect(await readViewbookAsset(String(id), filename)).not.toBeNull()
  })
})

describe('collectAssessmentImageSnapshot', () => {
  it('returns viewbookId + filenames for a client with images', async () => {
    const { id, clientId } = await ownViewbook()
    const a = await addAssessmentImage(id, PNG_1PX, 'op@er.com')
    const b = await addAssessmentImage(id, PNG_1PX, 'op@er.com')

    const snapshot = await collectAssessmentImageSnapshot(clientId)
    expect(snapshot?.viewbookId).toBe(id)
    expect(snapshot?.filenames.sort()).toEqual([a.filename, b.filename].sort())
  })

  it('returns an empty filenames array for a viewbook with no assessment content', async () => {
    const { clientId } = await ownViewbook()
    const snapshot = await collectAssessmentImageSnapshot(clientId)
    expect(snapshot?.filenames).toEqual([])
  })

  it('returns null for a client with no viewbook', async () => {
    const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
    expect(await collectAssessmentImageSnapshot(client.id)).toBeNull()
  })
})
