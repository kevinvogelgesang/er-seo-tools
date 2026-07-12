import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { requireContentAuditToken } from './route-auth'
import { mintContentAuditToken } from '../content-audit-token'

const req = (token?: string) =>
  new NextRequest('https://app.test/api/content-audit/audit_1/manifest', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('requireContentAuditToken', () => {
  it('accepts a valid cat_ token with the required scope', async () => {
    const { token } = await mintContentAuditToken('audit_1')
    const r = await requireContentAuditToken(req(token), 'audit_1', 'read')
    expect(r.ok).toBe(true)
  })
  it('401s a missing token', async () => {
    const r = await requireContentAuditToken(req(), 'audit_1', 'read')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.res.status).toBe(401)
  })
  it('401s a sub mismatch', async () => {
    const { token } = await mintContentAuditToken('audit_1')
    const r = await requireContentAuditToken(req(token), 'audit_2', 'read')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.res.status).toBe(401)
  })
})
