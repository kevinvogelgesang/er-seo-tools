import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook, setSectionState } from './service'
import { requireViewbookToken } from './route-auth'
import { notifyAdminEmail } from '@/lib/notify/config'
import { ACKABLE_SECTION_KEYS, acknowledgeSection as acknowledgeSectionCore, resetSectionAck } from './ack'
import { runViewbookEmailJob } from '@/lib/jobs/handlers/viewbook-email'

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})
const { enqueueJob } = await import('@/lib/jobs/queue')

const PREFIX = 'vb-test-ack-'
const OPERATOR = 'operator@example.com'
const OLD_ENV = process.env
const LEGACY_TEST_AUTH = { principal: { kind: 'operator', email: 'client' } } as const

function acknowledgeSection(...args: [Parameters<typeof acknowledgeSectionCore>[0], Parameters<typeof acknowledgeSectionCore>[1], Parameters<typeof acknowledgeSectionCore>[2], Parameters<typeof acknowledgeSectionCore>[4]?]) {
  return acknowledgeSectionCore(args[0], args[1], args[2], LEGACY_TEST_AUTH, args[3])
}

async function mkViewbook(opts: { csmName?: string | null } = {}) {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', OPERATOR)
  await prisma.viewbook.update({
    where: { id: created.id },
    data: { stage: 'post-contract', csmName: opts.csmName ?? null },
  })
  const viewbook = await requireViewbookToken(created.token)
  return { client, viewbook, token: created.token }
}

function mutationId() { return crypto.randomUUID() }

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

async function ackAll(ctx: Awaited<ReturnType<typeof mkViewbook>>, exclude: string[] = []) {
  for (const key of ACKABLE_SECTION_KEYS) {
    if (exclude.includes(key)) continue
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: key, clientMutationId: mutationId() })
  }
}

function pcDeliveryKey(viewbookId: number): string {
  return `vb-pc-complete:${viewbookId}`
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

describe('acknowledgeSection', () => {
  it('stamps acknowledgedAt + one section-ack activity + syncVersion +1; re-ack is a replayed no-op', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)

    const result = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    expect(result.replayed).toBe(false)
    expect(result.pcCompleted).toBe(false)
    expect(result.acknowledged.acknowledgedAt).not.toBeNull()
    const afterFirst = await syncVersion(ctx.viewbook.id)
    expect(afterFirst).toBe(before + 1)
    const activity = await prisma.viewbookActivity.findMany({ where: { viewbookId: ctx.viewbook.id, kind: 'section-ack' } })
    expect(activity).toHaveLength(1)
    expect(activity[0].summary).toContain('pc-setup')

    const replay = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    expect(replay.replayed).toBe(true)
    expect(replay.pcCompleted).toBe(false)
    expect(await syncVersion(ctx.viewbook.id)).toBe(afterFirst)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'section-ack' } })).toBe(1)
  })

  it('rejects a non-ackable sectionKey with 400', async () => {
    const ctx = await mkViewbook()
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'welcome', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_section' })
  })

  it('rejects a missing or malformed clientMutationId with 400', async () => {
    const ctx = await mkViewbook()
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: undefined as unknown as string }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_client_mutation_id' })
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_client_mutation_id' })
  })

  it('404s acking a hidden ackable section', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-setup' } },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })

  it('404s acking after the viewbook is revoked', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('404s acking after the client is archived', async () => {
    const ctx = await mkViewbook()
    await prisma.client.update({ where: { id: ctx.client.id }, data: { archivedAt: new Date() } })
    await expect(
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('completes post-contract on the final ack, creating exactly one pc-complete delivery, and the enqueued handler sends/suppresses correctly', async () => {
    const ctx = await mkViewbook()
    await ackAll(ctx, ['data-source'])
    const before = await syncVersion(ctx.viewbook.id)

    const result = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })
    expect(result.pcCompleted).toBe(true)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)

    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vb.pcCompletedAt).not.toBeNull()

    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].sentAt).toBeNull()
    expect(deliveries[0].suppressedAt).toBeNull()
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { deliveryId: deliveries[0].id } }))

    process.env = { ...OLD_ENV, MAILGUN_API_KEY: 'test-key', MAILGUN_DOMAIN: 'mg.example.com', NEXT_PUBLIC_APP_URL: 'https://app.example.com' }
    const sendEmail = vi.fn(async () => {})
    await runViewbookEmailJob({ deliveryId: deliveries[0].id }, { sendEmail })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sentRow = await prisma.viewbookEmailDelivery.findUniqueOrThrow({ where: { id: deliveries[0].id } })
    expect(sentRow.sentAt).not.toBeNull()
  })

  it('suppresses the pc-complete send in a dark (no Mailgun env) environment', async () => {
    const ctx = await mkViewbook()
    await ackAll(ctx, ['data-source'])
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })
    const delivery = await prisma.viewbookEmailDelivery.findFirstOrThrow({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })

    process.env = { ...OLD_ENV }
    delete process.env.MAILGUN_API_KEY
    delete process.env.MAILGUN_DOMAIN
    const sendEmail = vi.fn(async () => {})
    await runViewbookEmailJob({ deliveryId: delivery.id }, { sendEmail })
    expect(sendEmail).not.toHaveBeenCalled()
    const row = await prisma.viewbookEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(row.suppressedAt).not.toBeNull()
  })

  it('blocks completion while a hidden ackable section remains unacknowledged', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-invite' } },
      data: { state: 'hidden' },
    })
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    const result = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })
    expect(result.pcCompleted).toBe(false)
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vb.pcCompletedAt).toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })).toBe(0)
  })

  it('counts a hidden ackable section when it was acknowledged before being hidden', async () => {
    const ctx = await mkViewbook()
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-invite', clientMutationId: mutationId() })
    await setSectionState(ctx.viewbook.id, 'pc-invite', 'hidden', OPERATOR)
    expect(await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })).toBe(0)

    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    const result = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })

    expect(result.pcCompleted).toBe(true)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).pcCompletedAt).not.toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })).toBe(1)
  })

  it('blocks completion when a required ackable section row is missing', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.delete({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-invite' } },
    })

    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    const result = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })

    expect(result.pcCompleted).toBe(false)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).pcCompletedAt).toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })).toBe(0)
  })

  it('exactly one pcCompletedAt winner + one delivery under a concurrent last-ack', async () => {
    const ctx = await mkViewbook()
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })

    const [r1, r2] = await Promise.all([
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-invite', clientMutationId: mutationId() }),
    ])
    const winners = [r1.pcCompleted, r2.pcCompleted].filter(Boolean)
    expect(winners).toHaveLength(1)

    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(deliveries).toHaveLength(1)
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vb.pcCompletedAt).not.toBeNull()
  })

  it('resolves the completion recipient to the assigned CSM email', async () => {
    await prisma.viewbookGlobalContent.upsert({
      where: { key: 'team' },
      create: {
        key: 'team',
        bodyJson: JSON.stringify([{ name: 'Ack CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'ack-csm@example.com' }]),
        updatedBy: OPERATOR,
      },
      update: {
        bodyJson: JSON.stringify([{ name: 'Ack CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'ack-csm@example.com' }]),
      },
    })
    const ctx = await mkViewbook({ csmName: 'Ack CSM' })
    await ackAll(ctx, ['data-source'])
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })
    const delivery = await prisma.viewbookEmailDelivery.findFirstOrThrow({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(delivery.recipient).toBe('ack-csm@example.com')
  })

  it('falls back to notifyAdminEmail when no CSM is assigned', async () => {
    const ctx = await mkViewbook({ csmName: null })
    await ackAll(ctx, ['data-source'])
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() })
    const delivery = await prisma.viewbookEmailDelivery.findFirstOrThrow({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(delivery.recipient).toBe(notifyAdminEmail())
  })

  it('a no-op re-ack of an already-acked section does NOT trigger completion (Codex fix 2)', async () => {
    const ctx = await mkViewbook()
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-invite', clientMutationId: mutationId() })
    // data-source remains unacked — pcCompletedAt still null.
    const before = await syncVersion(ctx.viewbook.id)

    const replay = await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() })
    expect(replay.replayed).toBe(true)
    expect(replay.pcCompleted).toBe(false)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)

    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vb.pcCompletedAt).toBeNull()
    expect(await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })).toBe(0)
  })
})

describe('section hiding never completes post-contract', () => {
  it('does not stamp completion or create a delivery when the last unacknowledged ackable section is hidden', async () => {
    const ctx = await mkViewbook()
    await ackAll(ctx, ['pc-invite'])
    const before = await syncVersion(ctx.viewbook.id)

    await setSectionState(ctx.viewbook.id, 'pc-invite', 'hidden', OPERATOR)

    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vb.pcCompletedAt).toBeNull()
    const deliveries = await prisma.viewbookEmailDelivery.findMany({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(deliveries).toHaveLength(0)
  })

  it('hiding an ackable section when already complete does not create a duplicate delivery', async () => {
    const ctx = await mkViewbook()
    await ackAll(ctx)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).pcCompletedAt).not.toBeNull()

    await setSectionState(ctx.viewbook.id, 'pc-setup', 'hidden', OPERATOR)

    const deliveries = await prisma.viewbookEmailDelivery.count({ where: { dedupKey: pcDeliveryKey(ctx.viewbook.id) } })
    expect(deliveries).toBe(1)
  })
})

describe('resetSectionAck', () => {
  it('clears acknowledgedAt + activity + syncVersion +1; re-reset is +0; never clears pcCompletedAt', async () => {
    const ctx = await mkViewbook()
    await ackAll(ctx)
    const vbBefore = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vbBefore.pcCompletedAt).not.toBeNull()

    const before = await syncVersion(ctx.viewbook.id)
    await resetSectionAck(ctx.viewbook.id, 'pc-setup', OPERATOR)
    expect(await syncVersion(ctx.viewbook.id)).toBe(before + 1)

    const section = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-setup' } },
    })
    expect(section.acknowledgedAt).toBeNull()
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'section-ack-reset' } })).toBe(1)

    const after = await syncVersion(ctx.viewbook.id)
    await resetSectionAck(ctx.viewbook.id, 'pc-setup', OPERATOR)
    expect(await syncVersion(ctx.viewbook.id)).toBe(after)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'section-ack-reset' } })).toBe(1)

    const vbAfter = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(vbAfter.pcCompletedAt?.getTime()).toBe(vbBefore.pcCompletedAt?.getTime())
  })

  it('rejects a non-ackable sectionKey with 400', async () => {
    const ctx = await mkViewbook()
    await expect(resetSectionAck(ctx.viewbook.id, 'welcome', OPERATOR)).rejects.toMatchObject({ status: 400, code: 'invalid_section' })
  })
})
