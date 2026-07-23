import { describe, expect, it } from 'vitest'
import { hashSecret, memberCookieName, mintSecret } from './auth-secrets'

describe('viewbook auth secrets', () => {
  it('mints 256-bit base64url secrets and stores only their SHA-256 hash', () => {
    const first = mintSecret()
    const second = mintSecret()

    expect(first.raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashSecret(first.raw)).toBe(first.hash)
    expect(second.raw).not.toBe(first.raw)
    expect(second.hash).not.toBe(first.hash)
  })

  it('names the isolated session cookie from the durable viewbook id', () => {
    expect(memberCookieName(7)).toBe('vb_s_7')
  })
})
