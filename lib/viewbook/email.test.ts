import crypto from 'crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '@/lib/jobs/types'
import {
  enqueueViewbookEmail,
  recoverViewbookEmailDeliveries,
  stageChangeDeliveryStatements,
} from './email'

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

const { enqueueJob } = await import('@/lib/jobs/queue')
const PREFIX = 'vb-email-core-test-'

async function makeViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return prisma.viewbook.create({
    data: { clientId: client.id, kind: 'upgrade', token: crypto.randomUUID() },
  })
}

beforeEach(async () => {
  vi.mocked(enqueueJob).mockClear()
  await prisma.job.deleteMany({ where: { type: VIEWBOOK_EMAIL_JOB_TYPE } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: VIEWBOOK_EMAIL_JOB_TYPE } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('stageChangeDeliveryStatements', () => {
  it('returns an empty statement list for no recipients', () => {
    expect(stageChangeDeliveryStatements({ viewbookId: 1, eventKey: crypto.randomUUID(), recipients: [] })).toEqual([])
  })

  it('creates one delivery statement per recipient with event-key dedup keys and nullable correlations', async () => {
    const viewbook = await makeViewbook()
    const eventKey = crypto.randomUUID()
    const recipients = ['one@example.com', 'two@example.com']
    const statements = stageChangeDeliveryStatements({ viewbookId: viewbook.id, eventKey, recipients })
    expect(statements).toHaveLength(2)

    await prisma.$transaction(statements)
    const rows = await prisma.viewbookEmailDelivery.findMany({
      where: { viewbookId: viewbook.id },
      orderBy: { recipient: 'asc' },
    })
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'stage-change', recipient: 'one@example.com',
        dedupKey: `vb-stage:${eventKey}:one@example.com`, memberId: null, stageLogId: null,
      }),
      expect.objectContaining({
        kind: 'stage-change', recipient: 'two@example.com',
        dedupKey: `vb-stage:${eventKey}:two@example.com`, memberId: null, stageLogId: null,
      }),
    ])
  })
})

describe('enqueueViewbookEmail', () => {
  it('uses the delivery id as the active-window dedup key and no group', async () => {
    await enqueueViewbookEmail(42)
    expect(enqueueJob).toHaveBeenCalledWith({
      type: VIEWBOOK_EMAIL_JOB_TYPE,
      payload: { deliveryId: 42 },
      dedupKey: 'viewbook-email:42',
    })
  })
})

describe('recoverViewbookEmailDeliveries', () => {
  it('re-enqueues only non-terminal deliveries for which no job row has ever existed', async () => {
    const viewbook = await makeViewbook()
    const stranded = await prisma.viewbookEmailDelivery.create({
      data: { viewbookId: viewbook.id, kind: 'stage-change', recipient: 'stranded@example.com', dedupKey: `vb-stage:${crypto.randomUUID()}:stranded@example.com` },
    })
    const previouslyQueued = await prisma.viewbookEmailDelivery.create({
      data: { viewbookId: viewbook.id, kind: 'stage-change', recipient: 'old@example.com', dedupKey: `vb-stage:${crypto.randomUUID()}:old@example.com` },
    })
    await prisma.job.create({
      data: {
        type: VIEWBOOK_EMAIL_JOB_TYPE,
        payload: JSON.stringify({ deliveryId: previouslyQueued.id }),
        dedupKey: `viewbook-email:${previouslyQueued.id}`,
        status: 'complete',
        completedAt: new Date(),
      },
    })
    await prisma.viewbookEmailDelivery.create({
      data: { viewbookId: viewbook.id, kind: 'stage-change', recipient: 'sent@example.com', dedupKey: `vb-stage:${crypto.randomUUID()}:sent@example.com`, sentAt: new Date() },
    })

    await recoverViewbookEmailDeliveries()

    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: VIEWBOOK_EMAIL_JOB_TYPE,
      payload: { deliveryId: stranded.id },
      dedupKey: `viewbook-email:${stranded.id}`,
    }))
  })
})
