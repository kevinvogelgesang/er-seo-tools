import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH } from './route'
import { mintContentAuditToken } from '@/lib/content-audit-token'

const DOMAIN = 'patch-cat.example.com'
const params = (id: string) => ({ params: Promise.resolve({ siteAuditId: id }) })

async function seed() {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 60000) } })
  await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, contentText: 'body' } })
  return sa
}
const req = (id: string, token: string, body: unknown) =>
  new NextRequest('https://app.test/api/content-audit/' + id + '/findings', {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const finding = (url: string) => ({ type: 'data_inconsistency', severity: 'warning', title: 't', detail: 'd', evidence: [{ url, snippet: 's' }], recommendation: 'r' })

describe('PATCH content-audit findings', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('stores validated findings on the live-scan run', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [finding('https://x/a')] }), params(sa.id))
    expect(res.status).toBe(200)
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, select: { contentAuditJson: true } })
    expect(JSON.parse(run!.contentAuditJson!).findings[0].type).toBe('data_inconsistency')
  })
  it('rejects an evidence url not in the audit', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [finding('https://evil/x')] }), params(sa.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('evidence_url_not_in_audit')
  })
  it('401s a missing token', async () => {
    const sa = await seed()
    const res = await PATCH(new NextRequest('https://app.test/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"findings":[]}' }), params(sa.id))
    expect(res.status).toBe(401)
  })
  it('last-writer-wins: a second PATCH overwrites the first (Codex #5)', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    await PATCH(req(sa.id, token, { findings: [finding('https://x/a')] }), params(sa.id))
    await PATCH(req(sa.id, token, { findings: [] }), params(sa.id))
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, select: { contentAuditJson: true } })
    expect(JSON.parse(run!.contentAuditJson!).findings.length).toBe(0)
  })
  it('409s no_live_scan_run when the audit has no seo-parser run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 60000) } })
    const { token } = await mintContentAuditToken(sa.id)
    const res = await PATCH(req(sa.id, token, { findings: [] }), params(sa.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_live_scan_run')
  })
  it('413s an oversized body even with NO Content-Length header (Codex #3)', async () => {
    const sa = await seed(); const { token } = await mintContentAuditToken(sa.id)
    // Build a >300KB body via a ReadableStream so Content-Length is absent.
    const big = 'x'.repeat(320 * 1024)
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"pad":"${big}","findings":[]}`)); c.close() } })
    const r = new NextRequest('https://app.test/x', { method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' })
    const res = await PATCH(r, params(sa.id))
    expect(res.status).toBe(413)
  })
})
