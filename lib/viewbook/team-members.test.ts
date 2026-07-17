import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { requireViewbookToken } from './route-auth'
import { addTeamMember, resendInvite } from './team-members'
import { runViewbookEmailJob } from '@/lib/jobs/handlers/viewbook-email'

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})
const { enqueueJob } = await import('@/lib/jobs/queue')

const PREFIX = 'vb-test-team-'
const OPERATOR = 'operator@example.com'
const OLD_ENV = process.env
const DAY_MS = 24 * 60 * 60 * 1000

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', OPERATOR)
  await prisma.viewbook.update({ where: { id: created.id }, data: { stage: 'post-contract' } })
  const viewbook = await requireViewbookToken(created.token)
  return { client, viewbook, token: created.token }
}

function mutationId() { return crypto.randomUUID() }

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

async function seedMembers(viewbookId: number, count: number) {
  for (let i = 0; i < count; i++) {
    await prisma.viewbookTeamMember.create({
      data: {
        viewbookId,
        memberKey: crypto.randomUUID(),
        name: `Seed ${i}`,
        email: `seed-${i}-${crypto.randomUUID()}@example.com`,
        addedBy: 'client',
      },
    })
  }
}

async function seedInviteDeliveries(viewbookId: number, count: number, opts: { createdAt?: number } = {}) {
  for (let i = 0; i < count; i++) {
    await prisma.viewbookEmailDelivery.create({
      data: {
        viewbookId,
        kind: 'team-invite',
        recipient: `window-seed-${i}@example.com`,
        dedupKey: `vb-invite:${crypto.randomUUID()}:1`,
      },
    })
    if (opts.createdAt != null) {
      await prisma.$executeRaw`UPDATE "ViewbookEmailDelivery" SET "createdAt" = ${opts.createdAt} WHERE "viewbookId" = ${viewbookId} AND "recipient" = ${`window-seed-${i}@example.com`}`
    }
  }
}

beforeEach(() => {
  vi.mocked(enqueueJob).mockClear()
})

afterEach(() => {
  process.env = OLD_ENV
})

afterAll(async () => {
  process.env = OLD_ENV
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('addTeamMember', () => {
  it('adds a member + one team-invite-add activity + syncVersion +1 + one vb-invite:<memberKey>:1 delivery; handler send/suppress works', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)

    const result = await addTeamMember(ctx.viewbook, ctx.token, {
      name: 'Jamie Client', email: 'Jamie@Example.com', clientMutationId: mutationId(),
    })
    expect(result.replayed).toBe(false)
    expect(result.delivered).toBe(true)
    expect(result.member.name).toBe('Jamie Client')
    expect(result.member.email).toBe('jamie@example.com')
    expect(result.member.memberKey).toBeTruthy()

    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)
    const activity = await prisma.viewbookActivity.findMany({ where: { viewbookId: ctx.viewbook.id, kind: 'team-invite-add' } })
    expect(activity).toHaveLength(1)
    expect(activity[0].summary).toContain('Jamie Client')

    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { dedupKey: `vb-invite:${result.member.memberKey}:1` } })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].recipient).toBe('jamie@example.com')
    expect(deliveries[0].sentAt).toBeNull()
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { deliveryId: deliveries[0].id } }))

    process.env = { ...OLD_ENV, MAILGUN_API_KEY: 'test-key', MAILGUN_DOMAIN: 'mg.example.com', NEXT_PUBLIC_APP_URL: 'https://app.example.com' }
    const sendEmail = vi.fn(async () => {})
    await runViewbookEmailJob({ deliveryId: deliveries[0].id }, { sendEmail })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((await prisma.viewbookEmailDelivery.findUniqueOrThrow({ where: { id: deliveries[0].id } })).sentAt).not.toBeNull()

    process.env = { ...OLD_ENV }
    delete process.env.MAILGUN_API_KEY
    delete process.env.MAILGUN_DOMAIN
    const ctx2 = await mkViewbook()
    const result2 = await addTeamMember(ctx2.viewbook, ctx2.token, { name: 'Dark Env', email: 'dark@example.com', clientMutationId: mutationId() })
    const delivery2 = await prisma.viewbookEmailDelivery.findFirstOrThrow({ where: { dedupKey: `vb-invite:${result2.member.memberKey}:1` } })
    const sendEmail2 = vi.fn(async () => {})
    await runViewbookEmailJob({ deliveryId: delivery2.id }, { sendEmail: sendEmail2 })
    expect(sendEmail2).not.toHaveBeenCalled()
    expect((await prisma.viewbookEmailDelivery.findUniqueOrThrow({ where: { id: delivery2.id } })).suppressedAt).not.toBeNull()
  })

  it('rejects an invalid email with 400 and creates no row', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)
    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Bad Email', email: 'not-an-email', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_email' })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(0)
  })

  it('rejects an empty or oversized name with 400', async () => {
    const ctx = await mkViewbook()
    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: '   ', email: 'x@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_name' })
    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'a'.repeat(121), email: 'x@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_name' })
  })

  it('rejects a duplicate email on the same viewbook honestly (409, not a replay), creating no second row', async () => {
    const ctx = await mkViewbook()
    await addTeamMember(ctx.viewbook, ctx.token, { name: 'First', email: 'dup@example.com', clientMutationId: mutationId() })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Second', email: 'DUP@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 409, code: 'duplicate_email' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id, email: 'dup@example.com' } })).toBe(1)
  })

  it('replays an identical clientMutationId as {replayed:true, delivered:true} with no bump', async () => {
    const ctx = await mkViewbook()
    const clientMutationId = mutationId()
    const first = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Replay Me', email: 'replay@example.com', clientMutationId })
    const before = await syncVersion(ctx.viewbook.id)

    const replay = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Replay Me', email: 'replay@example.com', clientMutationId })
    expect(replay.replayed).toBe(true)
    expect(replay.delivered).toBe(true)
    expect(replay.member.id).toBe(first.member.id)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(1)
  })

  it('blocks the 16th member (member cap 15) — 0 inserted, no bump', async () => {
    const ctx = await mkViewbook()
    await seedMembers(ctx.viewbook.id, 15)
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Overflow', email: 'overflow@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 409, code: 'team_member_limit_reached' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(15)
  })

  it('blocks the 11th add in a rolling 24h window ATOMICALLY — no member row, no delivery, no bump', async () => {
    const ctx = await mkViewbook()
    await seedInviteDeliveries(ctx.viewbook.id, 10, { createdAt: Date.now() - 1000 })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Windowed Out', email: 'windowed@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 429, code: 'invite_limit_reached' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id, email: 'windowed@example.com' } })).toBe(0)
    const windowCount = await prisma.viewbookEmailDelivery.count({
      where: { viewbookId: ctx.viewbook.id, kind: 'team-invite', createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    })
    expect(windowCount).toBeLessThanOrEqual(10)
  })

  it('does not count invite deliveries outside the 24h window against the cap', async () => {
    const ctx = await mkViewbook()
    await seedInviteDeliveries(ctx.viewbook.id, 10, { createdAt: Date.now() - DAY_MS - 60_000 })

    const result = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Fresh Window', email: 'fresh-window@example.com', clientMutationId: mutationId() })
    expect(result.delivered).toBe(true)
  })

  it('404s on a revoked viewbook and creates nothing', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })
    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Blocked', email: 'blocked@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(0)
  })

  it('404s replaying a prior add clientMutationId after pc-invite is hidden — not a 200 member echo', async () => {
    const ctx = await mkViewbook()
    const clientMutationId = mutationId()
    const first = await addTeamMember(ctx.viewbook, ctx.token, {
      name: 'Replay Then Hide', email: 'replay-then-hide@example.com', clientMutationId,
    })
    expect(first.replayed).toBe(false)
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-invite' } },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Replay Then Hide', email: 'replay-then-hide@example.com', clientMutationId }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    // The member row from the original (visible-section) add still exists —
    // this proves the 404 comes from the replay lookup's new section-visible
    // condition, not from the member having been deleted.
    expect(await prisma.viewbookTeamMember.count({ where: { id: first.member.id } })).toBe(1)
  })

  it('404s when the pc-invite section is hidden — no member, no delivery, no activity, syncVersion +0', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-invite' } },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Hidden Section', email: 'hidden-section@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookTeamMember.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(0)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: ctx.viewbook.id, kind: 'team-invite' } })).toBe(0)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'team-invite-add' } })).toBe(0)
  })
})

describe('resendInvite', () => {
  async function addedMember(ctx: Awaited<ReturnType<typeof mkViewbook>>) {
    const result = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Resend Target', email: 'resend@example.com', clientMutationId: mutationId() })
    return result.member
  }

  it('resends the invite with the next ordinal + syncVersion +1', async () => {
    const ctx = await mkViewbook()
    const member = await addedMember(ctx)
    const before = await syncVersion(ctx.viewbook.id)

    const result = await resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })
    expect(result.delivered).toBe(true)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)

    const delivery = await prisma.viewbookEmailDelivery.findFirstOrThrow({ where: { dedupKey: `vb-invite:${member.memberKey}:2` } })
    expect(delivery.recipient).toBe('resend@example.com')
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { deliveryId: delivery.id } }))
  })

  it('blocks the 4th send for a member (cap 3) — 0 new delivery, no bump; 2nd/3rd get ordinals :2/:3', async () => {
    const ctx = await mkViewbook()
    const member = await addedMember(ctx) // ordinal :1 from add

    const r2 = await resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })
    expect(r2.delivered).toBe(true)
    expect(await prisma.viewbookEmailDelivery.findFirst({ where: { dedupKey: `vb-invite:${member.memberKey}:2` } })).not.toBeNull()

    const r3 = await resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })
    expect(r3.delivered).toBe(true)
    expect(await prisma.viewbookEmailDelivery.findFirst({ where: { dedupKey: `vb-invite:${member.memberKey}:3` } })).not.toBeNull()

    const before = await syncVersion(ctx.viewbook.id)
    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })).rejects.toMatchObject({ status: 409, code: 'resend_limit_reached' })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: ctx.viewbook.id, dedupKey: { startsWith: `vb-invite:${member.memberKey}:` } } })).toBe(3)
  })

  it('blocks a resend when the 24h invite-delivery window cap is already hit', async () => {
    const ctx = await mkViewbook()
    const member = await addedMember(ctx) // consumes 1 of the 10 window slots
    await seedInviteDeliveries(ctx.viewbook.id, 9, { createdAt: Date.now() - 1000 })

    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })).rejects.toMatchObject({ status: 429, code: 'invite_limit_reached' })
  })

  it('resolves exactly one winner under a concurrent double-resend at the cap boundary, no duplicate dedupKey', async () => {
    const ctx = await mkViewbook()
    const member = await addedMember(ctx) // :1
    await resendInvite(ctx.viewbook, ctx.token, { memberId: member.id }) // :2 — now 2 existing sends

    const [r1, r2] = await Promise.allSettled([
      resendInvite(ctx.viewbook, ctx.token, { memberId: member.id }),
      resendInvite(ctx.viewbook, ctx.token, { memberId: member.id }),
    ])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toMatchObject({ status: 409, code: 'resend_limit_reached' })
    }

    const deliveries = await prisma.viewbookEmailDelivery.findMany({
      where: { viewbookId: ctx.viewbook.id, dedupKey: { startsWith: `vb-invite:${member.memberKey}:` } },
    })
    expect(deliveries).toHaveLength(3)
    const dedupKeys = deliveries.map((d) => d.dedupKey)
    expect(new Set(dedupKeys).size).toBe(dedupKeys.length)
  })

  it('404s / no-ops for an unknown memberId', async () => {
    const ctx = await mkViewbook()
    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: 9_999_999 })).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('404s for a memberId that belongs to a different viewbook', async () => {
    const ctx1 = await mkViewbook()
    const ctx2 = await mkViewbook()
    const member = await addedMember(ctx1)
    await expect(resendInvite(ctx2.viewbook, ctx2.token, { memberId: member.id })).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('404s when the pc-invite section is hidden — no new delivery, syncVersion +0', async () => {
    const ctx = await mkViewbook()
    const member = await addedMember(ctx) // ordinal :1 while the section was still visible
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-invite' } },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)

    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: member.id })).rejects.toMatchObject({ status: 404, code: 'not_found' })

    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
    expect(
      await prisma.viewbookEmailDelivery.count({ where: { viewbookId: ctx.viewbook.id, dedupKey: { startsWith: `vb-invite:${member.memberKey}:` } } }),
    ).toBe(1)
  })
})

describe('relative-delta sync bumps', () => {
  it('a successful add bumps +1; a fully-blocked add (duplicate email) bumps +0', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)
    await addTeamMember(ctx.viewbook, ctx.token, { name: 'Delta', email: 'delta@example.com', clientMutationId: mutationId() })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)

    const afterAdd = await syncVersion(ctx.viewbook.id)
    await expect(
      addTeamMember(ctx.viewbook, ctx.token, { name: 'Dup', email: 'delta@example.com', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await syncVersion(ctx.viewbook.id)).toBe(afterAdd)
  })

  it('a clientMutationId replay of an add bumps +0 and reports replayed:true', async () => {
    const ctx = await mkViewbook()
    const clientMutationId = mutationId()
    await addTeamMember(ctx.viewbook, ctx.token, { name: 'Replay Delta', email: 'replay-delta@example.com', clientMutationId })
    const before = await syncVersion(ctx.viewbook.id)
    const replay = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Replay Delta', email: 'replay-delta@example.com', clientMutationId })
    expect(replay.replayed).toBe(true)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })

  it('a successful resend bumps +1; a fully-blocked resend bumps +0', async () => {
    const ctx = await mkViewbook()
    const added = await addTeamMember(ctx.viewbook, ctx.token, { name: 'Resend Delta', email: 'resend-delta@example.com', clientMutationId: mutationId() })
    const before = await syncVersion(ctx.viewbook.id)
    await resendInvite(ctx.viewbook, ctx.token, { memberId: added.member.id })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)

    await resendInvite(ctx.viewbook, ctx.token, { memberId: added.member.id }) // :3
    const beforeBlocked = await syncVersion(ctx.viewbook.id)
    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: added.member.id })).rejects.toMatchObject({ status: 409 })
    expect(await syncVersion(ctx.viewbook.id)).toBe(beforeBlocked)
  })
})
