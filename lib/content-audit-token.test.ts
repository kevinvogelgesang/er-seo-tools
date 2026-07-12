import { describe, it, expect } from 'vitest'
import {
  mintContentAuditToken, verifyContentAuditToken, ContentAuditTokenError,
} from './content-audit-token'
import { verifyKeywordStrategyToken } from './keyword-strategy-token'

describe('content-audit-token', () => {
  it('round-trips a cat_ token bound to a siteAuditId', async () => {
    const { token, expiresAt } = await mintContentAuditToken('audit_123')
    expect(token.startsWith('cat_')).toBe(true)
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    const payload = await verifyContentAuditToken(token, 'audit_123')
    expect(payload.sub).toBe('audit_123')
    expect(payload.scope).toEqual(['read', 'findings-write'])
  })

  it('rejects a token without the cat_ prefix', async () => {
    await expect(verifyContentAuditToken('kst_abc', 'audit_123'))
      .rejects.toThrow(ContentAuditTokenError)
  })

  it('rejects a sub mismatch', async () => {
    const { token } = await mintContentAuditToken('audit_123')
    await expect(verifyContentAuditToken(token, 'audit_999'))
      .rejects.toThrow(ContentAuditTokenError)
  })

  it('is audience-isolated from kst_ (cross-family JWT rejected both ways)', async () => {
    const { token } = await mintContentAuditToken('audit_123')
    // a cat_ token must NOT verify as kst_
    await expect(verifyKeywordStrategyToken(token, 'audit_123')).rejects.toThrow()
    // a kst_ body re-prefixed cat_ must NOT verify as cat_
    const { token: kst } = await import('./keyword-strategy-token')
      .then((m) => m.mintKeywordStrategyToken('audit_123'))
    const forged = 'cat_' + kst.slice('kst_'.length)
    await expect(verifyContentAuditToken(forged, 'audit_123')).rejects.toThrow(ContentAuditTokenError)
  })
})
