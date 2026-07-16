import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  checkWriteThrottle,
  readBoundedJson,
  requireJsonContentType,
  requireSameSite,
  resetWriteThrottleForTests,
  validateClientMutationId,
} from './public-write-guard'

beforeEach(resetWriteThrottleForTests)

describe('public viewbook write guard', () => {
  it('rejects cross-site requests before public mutation handling', () => {
    const request = new NextRequest('http://localhost/api/viewbook/token/feedback', {
      method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })
    expect(() => requireSameSite(request)).toThrow(expect.objectContaining({ status: 403, code: 'cross_site_request_blocked' }))
  })

  it('requires an application/json content type', () => {
    expect(() => requireJsonContentType(new Request('http://localhost', { method: 'POST' })))
      .toThrow(expect.objectContaining({ status: 415, code: 'json_content_type_required' }))
    expect(() => requireJsonContentType(new Request('http://localhost', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    }))).not.toThrow()
  })

  it('stream-caps and parses JSON bodies', async () => {
    await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{"ok":true}' }), 32))
      .resolves.toEqual({ ok: true })
    await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(33) }), 32))
      .rejects.toMatchObject({ status: 413, code: 'request_too_large' })
    await expect(readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{nope' }), 32))
      .rejects.toMatchObject({ status: 400, code: 'invalid_json' })
  })

  it('validates UUID mutation ids and throttles independently per token', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(validateClientMutationId(id)).toBe(id)
    expect(validateClientMutationId(undefined)).toBeNull()
    expect(() => validateClientMutationId('not-a-uuid')).toThrow(expect.objectContaining({ code: 'invalid_client_mutation_id' }))
    for (let i = 0; i < 10; i += 1) checkWriteThrottle('a', i)
    expect(() => checkWriteThrottle('a', 10)).toThrow(expect.objectContaining({ status: 429, code: 'rate_limited' }))
    expect(() => checkWriteThrottle('b', 10)).not.toThrow()
  })
})
