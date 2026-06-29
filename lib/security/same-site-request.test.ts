import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { isSameSiteRequest, isMutatingMethod } from './same-site-request'

function req(headers: Record<string, string>, url = 'http://localhost/api/clients') {
  return new NextRequest(url, { method: 'POST', headers })
}

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL
afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL
})

describe('isSameSiteRequest', () => {
  it('allows a request with no Origin and no Sec-Fetch-Site (form post / non-browser)', () => {
    expect(isSameSiteRequest(req({}))).toBe(true)
  })

  it('allows same-origin / same-site / none Sec-Fetch-Site', () => {
    expect(isSameSiteRequest(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(isSameSiteRequest(req({ 'sec-fetch-site': 'same-site' }))).toBe(true)
    expect(isSameSiteRequest(req({ 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('rejects an explicitly cross-site Sec-Fetch-Site', () => {
    expect(isSameSiteRequest(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('allows an Origin matching the request origin', () => {
    expect(isSameSiteRequest(req({ origin: 'http://localhost' }))).toBe(true)
  })

  it('allows an Origin matching NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://seo.erstaging.site'
    expect(
      isSameSiteRequest(req({ origin: 'https://seo.erstaging.site' }, 'http://internal-host/api/clients')),
    ).toBe(true)
  })

  it('rejects an untrusted Origin', () => {
    expect(isSameSiteRequest(req({ origin: 'https://attacker.example' }))).toBe(false)
  })

  it('rejects a cross-site Sec-Fetch-Site even if Origin looks trusted', () => {
    expect(
      isSameSiteRequest(req({ origin: 'http://localhost', 'sec-fetch-site': 'cross-site' })),
    ).toBe(false)
  })
})

describe('isMutatingMethod', () => {
  it('is true for state-changing methods (case-insensitive)', () => {
    for (const m of ['POST', 'put', 'Patch', 'DELETE']) expect(isMutatingMethod(m)).toBe(true)
  })
  it('is false for safe methods', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(isMutatingMethod(m)).toBe(false)
  })
})
