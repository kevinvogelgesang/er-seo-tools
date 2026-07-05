// A3 Task 7 — characterization tests for GET/PUT /api/site-audit/[id]/checks.
// Pins CURRENT behavior; do not "fix" anything found here in Phase 1.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'

const PREFIX = '__a3sa__'
const VALID_KEY = '0'.repeat(64)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/site-audit/1/checks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function clear() {
  await prisma.siteAuditCheck.deleteMany({ where: { siteAudit: { domain: { startsWith: PREFIX } } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

async function makeAudit(tag: string) {
  return prisma.siteAudit.create({
    data: { domain: `${PREFIX}${tag}`, status: 'complete', wcagLevel: 'wcag21aa' },
  })
}

describe('GET /api/site-audit/[id]/checks', () => {
  it('200 { checks } for an existing audit', async () => {
    const audit = await makeAudit('get-ok')
    const res = await GET(new NextRequest('http://localhost/api/site-audit/1/checks'), params(audit.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checks: [] })
  })

  it('404 "Audit not found" for a missing id', async () => {
    const res = await GET(new NextRequest('http://localhost/api/site-audit/1/checks'), params('nope'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Audit not found')
  })
})

describe('PUT /api/site-audit/[id]/checks', () => {
  it('404 "Audit not found" for a missing id (checked before body parse)', async () => {
    const res = await PUT(jsonReq('PUT', { scope: 'page', key: VALID_KEY, checked: true }), params('nope'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Audit not found')
  })

  it('400 invalid_json on malformed body', async () => {
    // A3: normalized from "Invalid JSON"
    const audit = await makeAudit('bad-json')
    const res = await PUT(jsonReq('PUT', '{not json'), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('400 when scope is not "page" or "page-violation"', async () => {
    const audit = await makeAudit('bad-scope')
    const res = await PUT(jsonReq('PUT', { scope: 'node', key: VALID_KEY, checked: true }), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      'scope must be "page" or "page-violation", key must be string, checked must be boolean',
    )
  })

  it('400 when key is non-string', async () => {
    const audit = await makeAudit('bad-key-type')
    const res = await PUT(jsonReq('PUT', { scope: 'page', key: 123, checked: true }), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      'scope must be "page" or "page-violation", key must be string, checked must be boolean',
    )
  })

  it('400 when checked is non-boolean', async () => {
    const audit = await makeAudit('bad-checked-type')
    const res = await PUT(jsonReq('PUT', { scope: 'page', key: VALID_KEY, checked: 'yes' }), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      'scope must be "page" or "page-violation", key must be string, checked must be boolean',
    )
  })

  it('400 when key is not 64-hex', async () => {
    const audit = await makeAudit('bad-key-hex')
    const res = await PUT(jsonReq('PUT', { scope: 'page', key: 'not-hex', checked: true }), params(audit.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('key must be a 64-char lowercase hex string')
  })

  it('200 { checks } on a valid PUT and persists via setSiteAuditCheck', async () => {
    const audit = await makeAudit('valid')
    const res = await PUT(
      jsonReq('PUT', { scope: 'page', key: VALID_KEY, checked: true }),
      params(audit.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks).toHaveLength(1)
    expect(body.checks[0]).toMatchObject({ siteAuditId: audit.id, scope: 'page', key: VALID_KEY })

    const row = await prisma.siteAuditCheck.findUnique({
      where: { siteAuditId_scope_key: { siteAuditId: audit.id, scope: 'page', key: VALID_KEY } },
    })
    expect(row).not.toBeNull()

    // A follow-up GET reflects the same persisted check.
    const getRes = await GET(new NextRequest('http://localhost/api/site-audit/1/checks'), params(audit.id))
    expect((await getRes.json()).checks).toHaveLength(1)
  })

  it('unchecking a persisted key removes it', async () => {
    const audit = await makeAudit('uncheck')
    await PUT(jsonReq('PUT', { scope: 'page-violation', key: VALID_KEY, checked: true }), params(audit.id))
    const res = await PUT(
      jsonReq('PUT', { scope: 'page-violation', key: VALID_KEY, checked: false }),
      params(audit.id),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).checks).toHaveLength(0)
  })
})
