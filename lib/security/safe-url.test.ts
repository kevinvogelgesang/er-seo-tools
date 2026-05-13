import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SafeUrlError,
  assertSafeHttpUrl,
  isPrivateOrInternalAddress,
  readResponseTextWithLimit,
  safeFetch,
} from './safe-url'

describe('isPrivateOrInternalAddress', () => {
  it('blocks private, loopback, link-local, and unspecified IPv4 addresses', () => {
    expect(isPrivateOrInternalAddress('127.0.0.1')).toBe(true)
    expect(isPrivateOrInternalAddress('10.0.0.1')).toBe(true)
    expect(isPrivateOrInternalAddress('172.16.0.1')).toBe(true)
    expect(isPrivateOrInternalAddress('172.31.255.255')).toBe(true)
    expect(isPrivateOrInternalAddress('192.168.1.1')).toBe(true)
    expect(isPrivateOrInternalAddress('169.254.1.1')).toBe(true)
    expect(isPrivateOrInternalAddress('0.0.0.0')).toBe(true)
    expect(isPrivateOrInternalAddress('100.64.0.1')).toBe(true)
    expect(isPrivateOrInternalAddress('198.18.0.1')).toBe(true)
    expect(isPrivateOrInternalAddress('203.0.113.10')).toBe(true)
    expect(isPrivateOrInternalAddress('224.0.0.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateOrInternalAddress('8.8.8.8')).toBe(false)
    expect(isPrivateOrInternalAddress('1.1.1.1')).toBe(false)
  })

  it('blocks private, loopback, link-local, and unspecified IPv6 addresses', () => {
    expect(isPrivateOrInternalAddress('::1')).toBe(true)
    expect(isPrivateOrInternalAddress('::')).toBe(true)
    expect(isPrivateOrInternalAddress('fc00::1')).toBe(true)
    expect(isPrivateOrInternalAddress('fd12::1')).toBe(true)
    expect(isPrivateOrInternalAddress('fe80::1')).toBe(true)
  })

  it('blocks IPv6 multicast and reserved ranges', () => {
    expect(isPrivateOrInternalAddress('ff02::1')).toBe(true)
    expect(isPrivateOrInternalAddress('ff00::1')).toBe(true)
    expect(isPrivateOrInternalAddress('100::1')).toBe(true)
    expect(isPrivateOrInternalAddress('2001:db8::1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateOrInternalAddress('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertSafeHttpUrl', () => {
  const publicLookup = vi.fn(async () => [{ address: '93.184.216.34' }])

  it('rejects unsupported protocols', async () => {
    await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toThrow(SafeUrlError)
  })

  it('rejects localhost and single-label internal hostnames before DNS lookup', async () => {
    await expect(assertSafeHttpUrl('http://localhost', { lookup: publicLookup })).rejects.toThrow(/private\/internal/)
    await expect(assertSafeHttpUrl('https://intranet', { lookup: publicLookup })).rejects.toThrow(/internal hostnames/)
    expect(publicLookup).not.toHaveBeenCalled()
  })

  it('rejects hostnames that resolve to private addresses', async () => {
    const lookup = vi.fn(async () => [{ address: '10.0.0.5' }])
    await expect(assertSafeHttpUrl('https://example.com', { lookup })).rejects.toThrow(/private\/internal/)
  })

  it('accepts http and https URLs resolving only to public addresses', async () => {
    await expect(assertSafeHttpUrl('https://example.com/path', { lookup: publicLookup })).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'example.com',
    })
  })
})

describe('safeFetch', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('validates each redirect before following it', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const transport = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/admin' },
    }))

    await expect(safeFetch('https://example.com', undefined, { lookup, transport })).rejects.toThrow(/private\/internal/)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('returns the final public redirect response', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 301,
        headers: { Location: 'https://www.example.com/final' },
      }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const result = await safeFetch('https://example.com', undefined, { lookup, transport })

    expect(result.url).toBe('https://www.example.com/final')
    expect(result.redirects).toEqual(['https://www.example.com/final'])
    expect(await result.response.text()).toBe('ok')
  })

  it('passes the validated DNS address to the transport for pinning', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const transport = vi.fn(async () => new Response('ok', { status: 200 }))

    await safeFetch('https://example.com', undefined, { lookup, transport })

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'example.com' }),
      expect.any(Object),
      expect.objectContaining({
        addresses: [{ address: '93.184.216.34', family: 4 }],
      })
    )
  })
})

describe('readResponseTextWithLimit', () => {
  it('stops reading after the configured byte limit', async () => {
    const result = await readResponseTextWithLimit(new Response('abcdef'), 3)
    expect(result).toEqual({ text: 'abc', truncated: true })
  })
})
