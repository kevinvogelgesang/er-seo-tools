import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook, moveViewbookStage } from './service'
import { requireViewbookToken } from './route-auth'
import { setNotifyEmails as setNotifyEmailsCore } from './setup'
import { resolveAllowedNotifyRecipients } from './notify-recipients'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

const PREFIX = 'vb-test-setup-'
const OPERATOR = 'operator@example.com'
const LEGACY_TEST_AUTH = { principal: { kind: 'operator', email: 'client' } } as const

function setNotifyEmails(...args: [Parameters<typeof setNotifyEmailsCore>[0], Parameters<typeof setNotifyEmailsCore>[1], Parameters<typeof setNotifyEmailsCore>[2], Parameters<typeof setNotifyEmailsCore>[4]?]) {
  return setNotifyEmailsCore(args[0], args[1], args[2], LEGACY_TEST_AUTH, args[3])
}

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', OPERATOR)
  await prisma.viewbook.update({ where: { id: created.id }, data: { stage: 'post-contract' } })
  const viewbook = await requireViewbookToken(created.token)
  return { client, viewbook, token: created.token }
}

async function addMember(viewbookId: number, email: string) {
  await prisma.viewbookTeamMember.create({
    data: { viewbookId, memberKey: crypto.randomUUID(), name: 'Member', email, addedBy: 'client' },
  })
}

async function setPrimaryContact(viewbookId: number, value: string) {
  await prisma.viewbookField.update({
    where: { viewbookId_defKey: { viewbookId, defKey: 'school-contact-email' } },
    data: { value },
  })
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

afterEach(() => {})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('setNotifyEmails', () => {
  it('persists a valid subset of team + primary-contact emails, bumps +1', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    await setPrimaryContact(ctx.viewbook.id, 'primary@example.com')
    const before = await syncVersion(ctx.viewbook.id)

    const result = await setNotifyEmails(ctx.viewbook, ctx.token, {
      notifyEmails: ['member@example.com', 'primary@example.com'],
    })

    expect(result.notifyEmails).toEqual(['member@example.com', 'primary@example.com'])
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)
    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(JSON.parse(stored.clientNotifyJson)).toEqual(['member@example.com', 'primary@example.com'])
    const activity = await prisma.viewbookActivity.findMany({
      where: { viewbookId: ctx.viewbook.id, kind: 'notify-emails-set' },
    })
    expect(activity).toHaveLength(1)
  })

  it('rejects an address not already on the viewbook — 400 invalid_notify_recipient, +0', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['stranger@example.com'] }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_notify_recipient' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stored.clientNotifyJson).toBe('[]')
  })

  it('rejects more than 5 entries — 400, +0', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)
    const many = Array.from({ length: 6 }, (_, i) => `member${i}@example.com`)

    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: many }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_notify_emails' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })

  it('rejects a malformed mailbox — 400, +0', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['not-an-email'] }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_notify_emails' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })

  it('rejects a non-array notifyEmails — 400', async () => {
    const ctx = await mkViewbook()
    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: 'member@example.com' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_notify_emails' })
  })

  it('an empty array clears a previously-set list, bumps +1', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    await setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['member@example.com'] })
    const before = await syncVersion(ctx.viewbook.id)

    const result = await setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: [] })

    expect(result.notifyEmails).toEqual([])
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)
    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stored.clientNotifyJson).toBe('[]')
  })

  it('dedupes and lowercases posted addresses', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')

    const result = await setNotifyEmails(ctx.viewbook, ctx.token, {
      notifyEmails: ['MEMBER@example.com', 'member@EXAMPLE.com', 'Member@Example.Com'],
    })

    expect(result.notifyEmails).toEqual(['member@example.com'])
  })

  it('reposting the identical (deduped/canonicalized) list is value-idempotent — +0, no activity', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    await setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['member@example.com'] })
    const before = await syncVersion(ctx.viewbook.id)
    const activityBefore = await prisma.viewbookActivity.count({
      where: { viewbookId: ctx.viewbook.id, kind: 'notify-emails-set' },
    })

    // Same set, different submission order/case — canonicalizes to the same
    // stored value, so this must be a true no-op.
    const result = await setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['MEMBER@Example.com'] })

    expect(result.notifyEmails).toEqual(['member@example.com'])
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(
      await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'notify-emails-set' } }),
    ).toBe(activityBefore)
  })

  it('404s on a revoked viewbook and writes nothing', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })

    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['member@example.com'] }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })

    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stored.clientNotifyJson).toBe('[]')
  })

  it('revalidates recipient membership INSIDE the commit fence (TOCTOU) — a member removed between resolve and commit does not persist', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      setNotifyEmails(
        ctx.viewbook,
        ctx.token,
        { notifyEmails: ['member@example.com'] },
        {
          // Simulates a concurrent edit landing between
          // resolveAllowedNotifyRecipients() (pre-transaction) and the
          // transaction's commit — the recipient is no longer a member by
          // the time the fence evaluates.
          beforeCommit: async () => {
            await prisma.viewbookTeamMember.deleteMany({
              where: { viewbookId: ctx.viewbook.id, email: 'member@example.com' },
            })
          },
        },
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_notify_recipient' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stored.clientNotifyJson).toBe('[]')
    expect(
      await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'notify-emails-set' } }),
    ).toBe(0)
  })

  it('404s when the pc-setup section is hidden — no clientNotifyJson change, no activity, syncVersion +0', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-setup' } },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: ['member@example.com'] }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    const stored = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stored.clientNotifyJson).toBe('[]')
    expect(
      await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'notify-emails-set' } }),
    ).toBe(0)
  })
})

describe('resolveAllowedNotifyRecipients', () => {
  it('returns team-member emails union the primary-contact answer value, canonicalized', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'Member@Example.com')
    await setPrimaryContact(ctx.viewbook.id, 'PRIMARY@example.com')

    const allowed = await resolveAllowedNotifyRecipients(ctx.viewbook.id)

    expect(allowed).toEqual(new Set(['member@example.com', 'primary@example.com']))
  })

  it('returns an empty set for an unknown viewbook id', async () => {
    const allowed = await resolveAllowedNotifyRecipients(-1)
    expect(allowed.size).toBe(0)
  })
})

// Regression: moveViewbookStage must resolve recipients IDENTICALLY after
// the allowed-set resolver was factored out onto resolveAllowedNotifyRecipients
// (no behavior change) — mirrors service.test.ts's existing moveViewbookStage
// recipient-filtering coverage, exercised directly here against the shared
// helper's call site.
describe('moveViewbookStage recipient resolution (post-refactor regression)', () => {
  it('still filters clientNotifyJson down to team + primary-contact addresses only', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbook.update({
      where: { id: ctx.viewbook.id },
      // pcCompletedAt stamped: this test is about recipient-resolution
      // behavior, not the Task 6 ack-to-stage forward fence.
      data: {
        pcCompletedAt: new Date(),
        clientNotifyJson: JSON.stringify(['member@example.com', 'primary@example.com', 'stranger@example.com']),
      },
    })
    await addMember(ctx.viewbook.id, 'member@example.com')
    await setPrimaryContact(ctx.viewbook.id, 'PRIMARY@EXAMPLE.COM')

    await moveViewbookStage(ctx.viewbook.id, 'forward', 'post-contract', OPERATOR)

    const deliveries = await prisma.viewbookEmailDelivery.findMany({
      where: { viewbookId: ctx.viewbook.id },
      orderBy: { recipient: 'asc' },
    })
    expect(deliveries.map((d) => d.recipient)).toEqual(['member@example.com', 'primary@example.com'])
  })
})
