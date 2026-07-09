// app/api/site-audit/route.requested-by.test.ts
//
// C15: POST /api/site-audit derives requestedBy via the SSO-aware
// getOperatorLabel (verified session first, legacy cookie fallback) instead of
// the legacy er-operator-name cookie alone. Mock-based: queueSiteAuditRequest
// is mocked (real calls create AuditBatch rows + fire-and-forget processNext);
// lib/auth runs real against an explicit test secret.
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
    siteAudit: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/ada-audit/queue-request', () => ({
  queueSiteAuditRequest: vi.fn(),
}))

const { queueSiteAuditRequest } = await import('@/lib/ada-audit/queue-request')
const { createAuthCookieValue, AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME } = await import('@/lib/auth')
const { POST } = await import('./route')

const ORIG_SECRET = process.env.APP_AUTH_SECRET
beforeAll(() => { process.env.APP_AUTH_SECRET = 'test-auth-secret' })
afterAll(() => {
  if (ORIG_SECRET === undefined) delete process.env.APP_AUTH_SECRET
  else process.env.APP_AUTH_SECRET = ORIG_SECRET
})

beforeEach(() => {
  vi.mocked(queueSiteAuditRequest).mockReset()
  vi.mocked(queueSiteAuditRequest).mockResolvedValue({ kind: 'queued', id: 'audit-1' })
})

function req(opts: { session?: string; operator?: string }) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const cookies: string[] = []
  if (opts.session) cookies.push(`${AUTH_COOKIE_NAME}=${opts.session}`)
  if (opts.operator) cookies.push(`${OPERATOR_NAME_COOKIE_NAME}=${opts.operator}`)
  if (cookies.length) headers.set('cookie', cookies.join('; '))
  return new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers,
    body: JSON.stringify({ domain: 'c15rb.example' }),
  })
}

describe('POST /api/site-audit — requestedBy attribution (C15)', () => {
  it('passes the verified session name — even when a stale legacy cookie disagrees', async () => {
    const session = await createAuthCookieValue({ sub: 'google:1', email: 'kevin@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Kevin Vogelgesang' })
    const res = await POST(req({ session, operator: 'Stale Old Name' }))
    expect(res.status).toBe(202)
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'Kevin Vogelgesang' }),
    )
  })

  it('falls back to the session email when the session has no name', async () => {
    const session = await createAuthCookieValue({ sub: 'google:2', email: 'op@enrollmentresources.com', hd: 'enrollmentresources.com', name: null })
    const res = await POST(req({ session }))
    expect(res.status).toBe(202)
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'op@enrollmentresources.com' }),
    )
  })

  it('falls back to the sanitized legacy cookie when there is no session', async () => {
    const res = await POST(req({ operator: '  Kevin  ' }))
    expect(res.status).toBe(202)
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'Kevin' }),
    )
  })

  it('passes null when neither cookie is present', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(202)
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: null }),
    )
  })
})
