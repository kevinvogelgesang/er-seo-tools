import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = '__a3adashare__'

const params = (token: string) => ({ params: Promise.resolve({ token }) })

async function makeAudit(tag: string, data: { status: string; shareToken?: string | null; shareExpiresAt?: Date | null }) {
  return prisma.adaAudit.create({
    data: { url: `${PREFIX}${tag}`, status: data.status, shareToken: data.shareToken, shareExpiresAt: data.shareExpiresAt },
  })
}

async function clear() {
  await prisma.adaAuditCheck.deleteMany({ where: { adaAudit: { url: { startsWith: PREFIX } } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

describe('GET /api/ada-audit/share/[token]/checks', () => {
  it('404 Share link not found or expired for an unknown token', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/share/x/checks'), params(`${PREFIX}unknown-token`))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Share link not found or expired')
  })

  it('404 for a non-complete status even with a valid unexpired shareExpiresAt', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await makeAudit('notcomplete', { status: 'running', shareToken: `${PREFIX}notcomplete`, shareExpiresAt: future })
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/share/x/checks'), params(`${PREFIX}notcomplete`))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Share link not found or expired')
  })

  it('404 for a complete audit with no shareExpiresAt', async () => {
    await makeAudit('noexpiry', { status: 'complete', shareToken: `${PREFIX}noexpiry`, shareExpiresAt: null })
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/share/x/checks'), params(`${PREFIX}noexpiry`))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Share link not found or expired')
  })

  it('404 for a complete audit with an expired shareExpiresAt', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await makeAudit('expired', { status: 'complete', shareToken: `${PREFIX}expired`, shareExpiresAt: past })
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/share/x/checks'), params(`${PREFIX}expired`))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Share link not found or expired')
  })

  it('200 { checks } for a complete audit with a valid unexpired shareToken', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const audit = await makeAudit('valid', { status: 'complete', shareToken: `${PREFIX}valid`, shareExpiresAt: future })
    await prisma.adaAuditCheck.create({
      data: { adaAuditId: audit.id, scope: 'node', key: 'a'.repeat(64) },
    })
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/share/x/checks'), params(`${PREFIX}valid`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks).toHaveLength(1)
    expect(body.checks[0].key).toBe('a'.repeat(64))
  })
})
