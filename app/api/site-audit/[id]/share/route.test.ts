// app/api/site-audit/[id]/share/route.test.ts
//
// DB-backed tests for the C4 site-audit share mint route (mirror of the
// AdaAudit one). Seeds real SiteAudit rows (domain prefix c4shr-route-*)
// against local-dev.db and calls the handlers directly.
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'

const PREFIX = 'c4shr-route-'
const createdIds: string[] = []

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(id: string, method: 'POST' | 'GET' = 'POST') {
  return new NextRequest(`http://localhost:3000/api/site-audit/${id}/share`, { method })
}

async function seedSiteAudit(opts: {
  status?: string
  shareToken?: string | null
  shareExpiresAt?: Date | null
  seoOnly?: boolean
} = {}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${crypto.randomUUID().slice(0, 8)}.example`,
      status: opts.status ?? 'complete',
      wcagLevel: 'wcag21aa',
      shareToken: opts.shareToken ?? null,
      shareExpiresAt: opts.shareExpiresAt ?? null,
      seoOnly: opts.seoOnly ?? false,
    },
  })
  createdIds.push(audit.id)
  return audit
}

describe('/api/site-audit/[id]/share (DB-backed)', () => {
  beforeAll(async () => {
    // Pre-clean any leftovers from interrupted runs (by prefix).
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  })

  afterAll(async () => {
    // Tracked ids only.
    await prisma.siteAudit.deleteMany({ where: { id: { in: createdIds } } })
  })

  it('mints a token on a complete audit: token persisted + share URL shape', async () => {
    const audit = await seedSiteAudit()

    const res = await POST(makeRequest(audit.id), makeParams(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()

    const row = await prisma.siteAudit.findUnique({
      where: { id: audit.id },
      select: { shareToken: true, shareExpiresAt: true },
    })
    expect(row?.shareToken).toBeTruthy()
    expect(row?.shareExpiresAt).toBeTruthy()

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    expect(body.shareUrl).toBe(`${origin}/ada-audit/site/share/${row!.shareToken}`)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
  })

  it('second POST returns the same token with an extended expiry', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000) // valid, but expiring soon
    const audit = await seedSiteAudit({ shareToken: crypto.randomUUID(), shareExpiresAt: soon })
    const originalToken = audit.shareToken

    const res = await POST(makeRequest(audit.id), makeParams(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()

    const row = await prisma.siteAudit.findUnique({
      where: { id: audit.id },
      select: { shareToken: true, shareExpiresAt: true },
    })
    expect(row?.shareToken).toBe(originalToken)
    expect(body.shareUrl).toContain(`/ada-audit/site/share/${originalToken}`)
    expect(row!.shareExpiresAt!.getTime()).toBeGreaterThan(soon.getTime())
  })

  it('rotates an expired token', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const expiredToken = crypto.randomUUID()
    const audit = await seedSiteAudit({ shareToken: expiredToken, shareExpiresAt: past })

    const res = await POST(makeRequest(audit.id), makeParams(audit.id))
    expect(res.status).toBe(200)

    const row = await prisma.siteAudit.findUnique({
      where: { id: audit.id },
      select: { shareToken: true, shareExpiresAt: true },
    })
    expect(row?.shareToken).toBeTruthy()
    expect(row?.shareToken).not.toBe(expiredToken)
    expect(row!.shareExpiresAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('returns 400 for a non-complete audit', async () => {
    const audit = await seedSiteAudit({ status: 'running' })

    const res = await POST(makeRequest(audit.id), makeParams(audit.id))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Site audit must be complete before sharing')
  })

  it('C11: share rejects a seoOnly audit', async () => {
    const audit = await seedSiteAudit({ seoOnly: true })

    const res = await POST(makeRequest(audit.id), makeParams(audit.id))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/seo/i)
  })

  it('returns 404 for an unknown audit', async () => {
    const res = await POST(makeRequest('nope-missing'), makeParams('nope-missing'))
    expect(res.status).toBe(404)
  })

  it('GET returns null shareToken after expiry', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const audit = await seedSiteAudit({ shareToken: crypto.randomUUID(), shareExpiresAt: past })

    const res = await GET(makeRequest(audit.id, 'GET'), makeParams(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ shareToken: null })
  })
})
