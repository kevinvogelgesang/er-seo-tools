import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { getJobHandler } from '../registry'
import { VIEWBOOK_EMAIL_JOB_TYPE } from '../types'
import {
  onViewbookEmailExhausted,
  registerViewbookEmailHandler,
  runViewbookEmailJob,
  type ViewbookEmailDeps,
} from './viewbook-email'
import { recoverViewbookEmailDeliveries } from '@/lib/viewbook/email'

const PREFIX = 'vb-email-handler-test-'
const OLD_ENV = process.env
const sendEmail = vi.fn(async () => {})
const deps: ViewbookEmailDeps = { sendEmail }

async function makeDelivery(options: {
  sentAt?: Date | null
  suppressedAt?: Date | null
  stage?: string
} = {}) {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const viewbook = await prisma.viewbook.create({
    data: { clientId: client.id, kind: 'upgrade', token: crypto.randomUUID(), stage: 'building' },
  })
  const eventKey = crypto.randomUUID()
  await prisma.viewbookStageLog.create({
    data: { viewbookId: viewbook.id, eventKey, stage: options.stage ?? 'kickoff', direction: 'forward', actor: 'op@er.com' },
  })
  return prisma.viewbookEmailDelivery.create({
    data: {
      viewbookId: viewbook.id,
      kind: 'stage-change',
      recipient: 'recipient@example.com',
      dedupKey: `vb-stage:${eventKey}:recipient@example.com`,
      sentAt: options.sentAt ?? null,
      suppressedAt: options.suppressedAt ?? null,
    },
  })
}

beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    MAILGUN_API_KEY: 'test-key',
    MAILGUN_DOMAIN: 'mg.example.com',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  }
  sendEmail.mockClear()
})

afterEach(async () => {
  process.env = OLD_ENV
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  process.env = OLD_ENV
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('viewbook-email job registration', () => {
  it('registers the required retry settings with the exhaustion kill-switch wired up', () => {
    registerViewbookEmailHandler()
    const handler = getJobHandler(VIEWBOOK_EMAIL_JOB_TYPE)
    expect(handler).toMatchObject({
      concurrency: 1,
      maxAttempts: 3,
      backoffBaseMs: 30_000,
      timeoutMs: 30_000,
    })
    expect(handler?.onExhausted).toBeDefined()
  })
})

describe('onViewbookEmailExhausted', () => {
  const ctx = { jobId: 'job-1', attempts: 3, lastError: 'boom' }

  it('stamps suppressedAt so the delivery becomes terminal (never sent, no retry storm)', async () => {
    const delivery = await makeDelivery()
    await onViewbookEmailExhausted({ deliveryId: delivery.id }, ctx)
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: expect.any(Date),
    })
  })

  it('cannot overwrite an existing sent marker', async () => {
    const sentAt = new Date('2030-01-02T03:04:05.000Z')
    const delivery = await makeDelivery({ sentAt })
    await onViewbookEmailExhausted({ deliveryId: delivery.id }, ctx)
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt,
      suppressedAt: null,
    })
  })

  it('never throws on a malformed payload', async () => {
    await expect(onViewbookEmailExhausted({ deliveryId: 'not-a-number' }, ctx)).resolves.toBeUndefined()
    await expect(onViewbookEmailExhausted(null, ctx)).resolves.toBeUndefined()
  })

  it('a subsequent recovery pass enqueues nothing, even after the error Job row is deleted', async () => {
    const delivery = await makeDelivery()
    await onViewbookEmailExhausted({ deliveryId: delivery.id }, ctx)

    // Simulate lib/jobs/retention.ts pruning the terminal error Job row (30 d) —
    // recovery must still skip this delivery because it is now suppressed,
    // not merely because a Job row happens to still exist.
    await prisma.job.deleteMany({ where: { type: VIEWBOOK_EMAIL_JOB_TYPE, dedupKey: `${VIEWBOOK_EMAIL_JOB_TYPE}:${delivery.id}` } })

    await recoverViewbookEmailDeliveries()

    expect(
      await prisma.job.findFirst({ where: { type: VIEWBOOK_EMAIL_JOB_TYPE, dedupKey: `${VIEWBOOK_EMAIL_JOB_TYPE}:${delivery.id}` } }),
    ).toBeNull()
  })
})

describe('runViewbookEmailJob', () => {
  it('dark env permanently suppresses without sending', async () => {
    const delivery = await makeDelivery()
    delete process.env.MAILGUN_API_KEY
    await runViewbookEmailJob({ deliveryId: delivery.id }, deps)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: expect.any(Date),
    })
  })

  it('dark-env suppression cannot overwrite an existing sent marker', async () => {
    const sentAt = new Date('2030-01-02T03:04:05.000Z')
    const delivery = await makeDelivery({ sentAt })
    delete process.env.MAILGUN_API_KEY
    await runViewbookEmailJob({ deliveryId: delivery.id }, deps)
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt,
      suppressedAt: null,
    })
  })

  it('sends once, announces the delivery event stage, and stamps sentAt', async () => {
    const delivery = await makeDelivery({ stage: 'kickoff' })
    await runViewbookEmailJob({ deliveryId: delivery.id }, deps)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const args = sendEmail.mock.calls[0][0]
    expect(args.to).toBe('recipient@example.com')
    expect(args.content.text).toContain('Kickoff')
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: expect.any(Date),
      suppressedAt: null,
    })
  })

  it('a transient viewbook-lookup error throws so the job retries (never sends a login-walled CTA)', async () => {
    const delivery = await makeDelivery()
    const original = prisma.viewbook.findUnique.bind(prisma.viewbook)
    const spy = vi.spyOn(prisma.viewbook, 'findUnique').mockRejectedValueOnce(new Error('transient db error'))
    await expect(runViewbookEmailJob({ deliveryId: delivery.id }, deps)).rejects.toThrow('transient db error')
    spy.mockImplementation(original)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: null,
    })
  })

  it('a deleted viewbook no-ops without sending or throwing', async () => {
    const delivery = await makeDelivery()
    const original = prisma.viewbook.findUnique.bind(prisma.viewbook)
    const spy = vi.spyOn(prisma.viewbook, 'findUnique').mockResolvedValueOnce(null as never)
    await expect(runViewbookEmailJob({ deliveryId: delivery.id }, deps)).resolves.toBeUndefined()
    spy.mockImplementation(original)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: null,
    })
  })

  it('already-terminal rows no-op for either terminal marker', async () => {
    const sent = await makeDelivery({ sentAt: new Date() })
    const suppressed = await makeDelivery({ suppressedAt: new Date() })
    await runViewbookEmailJob({ deliveryId: sent.id }, deps)
    await runViewbookEmailJob({ deliveryId: suppressed.id }, deps)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a missing row no-ops', async () => {
    await runViewbookEmailJob({ deliveryId: 999_999_999 }, deps)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a send failure leaves both terminal markers null so the job can retry', async () => {
    const delivery = await makeDelivery()
    sendEmail.mockRejectedValueOnce(new Error('transient'))
    await expect(runViewbookEmailJob({ deliveryId: delivery.id }, deps)).rejects.toThrow('transient')
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: null,
    })
  })

  it('the sent stamp cannot overwrite suppression that wins during the send', async () => {
    const delivery = await makeDelivery()
    sendEmail.mockImplementationOnce(async () => {
      await prisma.viewbookEmailDelivery.update({
        where: { id: delivery.id },
        data: { suppressedAt: new Date() },
      })
    })
    await runViewbookEmailJob({ deliveryId: delivery.id }, deps)
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: expect.any(Date),
    })
  })

  it('missing NEXT_PUBLIC_APP_URL is terminal suppression', async () => {
    const delivery = await makeDelivery()
    delete process.env.NEXT_PUBLIC_APP_URL
    await runViewbookEmailJob({ deliveryId: delivery.id }, deps)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await prisma.viewbookEmailDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      sentAt: null,
      suppressedAt: expect.any(Date),
    })
  })

  it('rejects malformed payloads', async () => {
    await expect(runViewbookEmailJob({ deliveryId: '1' }, deps)).rejects.toThrow('Invalid viewbook-email job payload')
  })
})
