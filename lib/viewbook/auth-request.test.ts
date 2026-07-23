import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'

vi.mock('./email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./email')>()
  return { ...actual, enqueueViewbookEmail: vi.fn(async () => ({ id: 'queued' })) }
})

import { enqueueViewbookEmail } from './email'
import { requestMagicLink } from './auth-request'
import { POST } from '@/app/api/viewbook/[token]/auth/request/route'

const PREFIX = 'vb-auth-request-u1-'
const ORIGINAL_ENV = { ...process.env }

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

async function addMember(viewbookId: number, email = `${crypto.randomUUID()}@example.com`) {
  return prisma.viewbookTeamMember.create({
    data: {
      viewbookId,
      memberKey: crypto.randomUUID(),
      name: 'Jamie Client',
      email,
      addedBy: 'operator@example.com',
    },
  })
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    VIEWBOOK_AUTH_COOLDOWN_MS: '60000',
    VIEWBOOK_AUTH_EMAIL_HOURLY_CAP: '6',
    VIEWBOOK_AUTH_VIEWBOOK_HOURLY_CAP: '30',
    VIEWBOOK_AUTH_LEDGER_HOURLY_CAP: '200',
  }
  vi.mocked(enqueueViewbookEmail).mockClear()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('requestMagicLink', () => {
  it('atomically records a member request and eligible delivery without minting a grant', async () => {
    const viewbook = await mkViewbook()
    const member = await addMember(viewbook.id, 'jamie@example.com')

    await requestMagicLink(viewbook, member.email)

    const request = await prisma.viewbookAuthRequest.findFirstOrThrow({ where: { viewbookId: viewbook.id } })
    const delivery = await prisma.viewbookEmailDelivery.findUniqueOrThrow({
      where: { dedupKey: `vb-magic-request:${request.id}` },
    })
    expect(delivery).toMatchObject({ kind: 'magic-link', recipient: member.email, memberId: member.id })
    expect(await prisma.viewbookAuthGrant.count({ where: { memberId: member.id } })).toBe(0)
    expect(enqueueViewbookEmail).toHaveBeenCalledWith(delivery.id)
  })

  it('records stranger demand without creating an eligible delivery', async () => {
    const viewbook = await mkViewbook()
    await requestMagicLink(viewbook, 'stranger@example.com')
    expect(await prisma.viewbookAuthRequest.count({ where: { viewbookId: viewbook.id } })).toBe(1)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: viewbook.id } })).toBe(0)
  })

  it('holds the cooldown under concurrent requests for the same mailbox', async () => {
    const viewbook = await mkViewbook()
    const member = await addMember(viewbook.id, 'cooldown@example.com')
    const now = Date.now()
    await Promise.all([
      requestMagicLink(viewbook, member.email, now),
      requestMagicLink(viewbook, member.email, now),
    ])
    expect(await prisma.viewbookAuthRequest.count({ where: { viewbookId: viewbook.id } })).toBe(1)
    expect(await prisma.viewbookEmailDelivery.count({ where: { viewbookId: viewbook.id } })).toBe(1)
  })

  it('holds global email and per-viewbook ledger caps at concurrent boundaries', async () => {
    process.env.VIEWBOOK_AUTH_EMAIL_HOURLY_CAP = '2'
    process.env.VIEWBOOK_AUTH_LEDGER_HOURLY_CAP = '2'
    const now = Date.now()
    const a = await mkViewbook()
    const b = await mkViewbook()
    const c = await mkViewbook()
    await Promise.all([
      requestMagicLink(a, 'global-cap@example.com', now),
      requestMagicLink(b, 'global-cap@example.com', now),
      requestMagicLink(c, 'global-cap@example.com', now),
    ])
    expect(await prisma.viewbookAuthRequest.count({ where: { email: 'global-cap@example.com' } })).toBe(2)

    const ledgerViewbook = await mkViewbook()
    await Promise.all([
      requestMagicLink(ledgerViewbook, 'ledger-a@example.com', now),
      requestMagicLink(ledgerViewbook, 'ledger-b@example.com', now),
      requestMagicLink(ledgerViewbook, 'ledger-c@example.com', now),
    ])
    expect(await prisma.viewbookAuthRequest.count({ where: { viewbookId: ledgerViewbook.id } })).toBe(2)
  })

  it('counts only eligible delivery rows against the viewbook capacity cap', async () => {
    process.env.VIEWBOOK_AUTH_VIEWBOOK_HOURLY_CAP = '2'
    process.env.VIEWBOOK_AUTH_LEDGER_HOURLY_CAP = '20'
    const viewbook = await mkViewbook()
    const now = Date.now()
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      requestMagicLink(viewbook, `stranger-${index}@example.com`, now),
    ))
    const a = await addMember(viewbook.id, 'eligible-a@example.com')
    const b = await addMember(viewbook.id, 'eligible-b@example.com')
    const c = await addMember(viewbook.id, 'eligible-c@example.com')
    await requestMagicLink(viewbook, a.email, now)
    await Promise.all([
      requestMagicLink(viewbook, b.email, now),
      requestMagicLink(viewbook, c.email, now),
    ])
    expect(await prisma.viewbookEmailDelivery.count({
      where: { viewbookId: viewbook.id, kind: 'magic-link' },
    })).toBe(2)
  })
})

describe('POST auth/request', () => {
  function post(token: string, body: unknown) {
    return POST(new NextRequest(`http://localhost/api/viewbook/${token}/auth/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ token }) })
  }

  it('returns the same 200 response for invited, stranger, and invalid mailboxes', async () => {
    const viewbook = await mkViewbook()
    await addMember(viewbook.id, 'route-member@example.com')
    const member = await post(viewbook.token, { email: 'Route-Member@Example.com' })
    const stranger = await post(viewbook.token, { email: 'stranger-route@example.com' })
    const invalid = await post(viewbook.token, { email: 'not-an-email' })
    expect([member.status, stranger.status, invalid.status]).toEqual([200, 200, 200])
    await expect(member.json()).resolves.toEqual({ ok: true })
    await expect(stranger.json()).resolves.toEqual({ ok: true })
    await expect(invalid.json()).resolves.toEqual({ ok: true })
  })

  it('rejects valid JSON primitives as invalid request shapes', async () => {
    const viewbook = await mkViewbook()
    const response = await post(viewbook.token, 'primitive')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
  })
})
