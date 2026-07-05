import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'

const PREFIX = '__a3ada__'
const VALID_KEY = 'a'.repeat(64)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function putReq(body: string): NextRequest {
  return new NextRequest('http://localhost/api/ada-audit/1/checks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

async function makeAudit(tag: string) {
  return prisma.adaAudit.create({
    data: { url: `${PREFIX}${tag}`, status: 'complete' },
  })
}

async function clear() {
  await prisma.adaAuditCheck.deleteMany({ where: { adaAudit: { url: { startsWith: PREFIX } } } })
  await prisma.adaAudit.deleteMany({ where: { url: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

describe('GET /api/ada-audit/[id]/checks', () => {
  it('200 { checks } for an existing audit', async () => {
    const audit = await makeAudit('get')
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/x/checks'), params(audit.id))
    expect(res.status).toBe(200)
    expect((await res.json()).checks).toEqual([])
  })

  it('404 Audit not found for a missing id', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/x/checks'), params('__a3ada__missing'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Audit not found')
  })
})

describe('PUT /api/ada-audit/[id]/checks', () => {
  it('400 Invalid JSON on malformed body', async () => {
    const audit = await makeAudit('badjson')
    const res = await PUT(putReq('{not json'), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON')
  })

  it('404 Audit not found for a missing id (checked before body parse)', async () => {
    const res = await PUT(putReq(JSON.stringify({ scope: 'node', key: VALID_KEY, checked: true })), params('__a3ada__missing'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Audit not found')
  })

  it('400 when scope is not "node"', async () => {
    const audit = await makeAudit('badscope')
    const res = await PUT(putReq(JSON.stringify({ scope: 'page', key: VALID_KEY, checked: true })), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('scope must be "node", key must be string, checked must be boolean')
  })

  it('400 when key is non-string', async () => {
    const audit = await makeAudit('badkeytype')
    const res = await PUT(putReq(JSON.stringify({ scope: 'node', key: 123, checked: true })), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('scope must be "node", key must be string, checked must be boolean')
  })

  it('400 when checked is non-boolean', async () => {
    const audit = await makeAudit('badchecked')
    const res = await PUT(putReq(JSON.stringify({ scope: 'node', key: VALID_KEY, checked: 'yes' })), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('scope must be "node", key must be string, checked must be boolean')
  })

  it('400 when key does not match the 64-hex shape', async () => {
    const audit = await makeAudit('badkeyshape')
    const res = await PUT(putReq(JSON.stringify({ scope: 'node', key: 'not-hex', checked: true })), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('key must be a 64-char lowercase hex string')
  })

  it('200 { checks } on a valid 64-hex key, persisted via a follow-up GET', async () => {
    const audit = await makeAudit('valid')
    const res = await PUT(putReq(JSON.stringify({ scope: 'node', key: VALID_KEY, checked: true })), params(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks).toHaveLength(1)
    expect(body.checks[0].key).toBe(VALID_KEY)

    const followUp = await GET(new NextRequest('http://localhost/api/ada-audit/x/checks'), params(audit.id))
    expect(followUp.status).toBe(200)
    const followUpBody = await followUp.json()
    expect(followUpBody.checks).toHaveLength(1)
    expect(followUpBody.checks[0].key).toBe(VALID_KEY)
  })
})
