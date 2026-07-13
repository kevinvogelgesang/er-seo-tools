import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import {
  SafeUrlError,
  assertSafeHttpUrl,
  createPinnedLookup,
  fetchWithPinnedAddress,
  isConstructibleResponseStatus,
  isPrivateOrInternalAddress,
  parseSafeHttpUrl,
  readResponseTextWithLimit,
  safeFetch,
} from './safe-url'

describe('isConstructibleResponseStatus', () => {
  // WHATWG `new Response(..., { status })` throws RangeError outside 200-599
  // (LinkedIn = 999, some CDNs). See the response-callback comment in
  // fetchWithPinnedAddress for the 2026-07-06 incident this guards against.
  it('accepts the WHATWG-constructible range 200-599', () => {
    expect(isConstructibleResponseStatus(200)).toBe(true)
    expect(isConstructibleResponseStatus(204)).toBe(true)
    expect(isConstructibleResponseStatus(301)).toBe(true)
    expect(isConstructibleResponseStatus(404)).toBe(true)
    expect(isConstructibleResponseStatus(599)).toBe(true)
  })
  it('rejects out-of-range statuses (incl. LinkedIn-style 999 and 1xx)', () => {
    expect(isConstructibleResponseStatus(999)).toBe(false)
    expect(isConstructibleResponseStatus(600)).toBe(false)
    expect(isConstructibleResponseStatus(199)).toBe(false)
    expect(isConstructibleResponseStatus(100)).toBe(false)
    expect(isConstructibleResponseStatus(0)).toBe(false)
    expect(isConstructibleResponseStatus(-1)).toBe(false)
  })
  it('rejects non-integer / NaN statuses (Number.isInteger guard)', () => {
    expect(isConstructibleResponseStatus(NaN)).toBe(false)
    expect(isConstructibleResponseStatus(200.5)).toBe(false)
  })
  it('matches what new Response actually permits (no RangeError on accepted values)', () => {
    for (const s of [200, 204, 301, 404, 599]) {
      expect(() => new Response(null, { status: s })).not.toThrow()
    }
    // sanity: the values we reject really do throw in the constructor
    expect(() => new Response(null, { status: 999 })).toThrow(RangeError)
  })
})

describe('fetchWithPinnedAddress (real transport against loopback)', () => {
  // Drives the ACTUAL node:http transport — the code path the 2026-07-06 hang
  // lived in. fetchWithPinnedAddress does no address validation (that lives in
  // resolveSafeHttpUrl), which is what makes a loopback server reachable here;
  // production traffic still goes through safeFetch's full SSRF pipeline.
  const resolvedFor = (url: URL) => ({
    url,
    addresses: [{ address: '127.0.0.1', family: 4 as const }],
  })

  async function withHttpServer(
    handler: Parameters<typeof createServer>[1],
    run: (url: URL) => Promise<void>
  ) {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      await run(new URL(`http://127.0.0.1:${port}/`))
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('rejects with SafeUrlError — never hangs — on out-of-range status 999', async () => {
    await withHttpServer(
      (_req, res) => {
        res.writeHead(999)
        res.end()
      },
      async (url) => {
        await expect(fetchWithPinnedAddress(url, undefined, resolvedFor(url)))
          .rejects.toThrow('Unsupported response status: 999')
        await expect(fetchWithPinnedAddress(url, undefined, resolvedFor(url)))
          .rejects.toBeInstanceOf(SafeUrlError)
      }
    )
  }, 10_000)

  it('tags the out-of-range status rejection with reason invalid-response', async () => {
    await withHttpServer(
      (_req, res) => {
        res.writeHead(999)
        res.end()
      },
      async (url) => {
        await expect(fetchWithPinnedAddress(url, undefined, resolvedFor(url)))
          .rejects.toMatchObject({ name: 'SafeUrlError', reason: 'invalid-response' })
      }
    )
  }, 10_000)

  it('resolves a normal 200 with body and headers', async () => {
    await withHttpServer(
      (_req, res) => {
        res.writeHead(200, { 'x-check': 'yes' })
        res.end('hello')
      },
      async (url) => {
        const response = await fetchWithPinnedAddress(url, undefined, resolvedFor(url))
        expect(response.status).toBe(200)
        expect(response.headers.get('x-check')).toBe('yes')
        expect(await response.text()).toBe('hello')
      }
    )
  }, 10_000)

  it('rejects via the idle-socket timeout when the server accepts but never responds', async () => {
    const accepted: Array<{ destroy: () => void }> = []
    const server = createNetServer((socket) => {
      accepted.push(socket) // accept, send nothing — a tarpit
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = new URL(`http://127.0.0.1:${port}/`)
    try {
      await expect(fetchWithPinnedAddress(url, undefined, resolvedFor(url), 100))
        .rejects.toThrow('Socket idle timeout')
    } finally {
      for (const socket of accepted) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10_000)
})

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

  it('cancels the unread body of intermediate redirect responses', async () => {
    const cancelled = vi.fn()
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(
        new ReadableStream({ cancel: cancelled }),
        { status: 301, headers: { Location: 'https://www.example.com/final' } }
      ))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    await safeFetch('https://example.com', undefined, { lookup, transport })
    // cancel() is fired-and-forgotten inside the redirect loop; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(cancelled).toHaveBeenCalled()
  })

  it('tags the redirect-limit rejection with reason redirect', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const transport = vi.fn(async () => new Response(null, {
      status: 301,
      headers: { Location: 'https://www.example.com/next' },
    }))

    await expect(
      safeFetch('https://example.com', undefined, { lookup, transport, maxRedirects: 1 })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'redirect' })
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

describe('createPinnedLookup', () => {
  // Regression: Node 20+'s Socket invokes the lookup with `{ all: true }` when
  // autoSelectFamily is enabled (default since Node 20). A legacy 3-arg
  // callback in that mode makes node:net throw "Invalid IP address: undefined"
  // and silently breaks every safeFetch.
  it('responds with the array form when options.all is true', () => {
    const lookup = createPinnedLookup({ address: '93.184.216.34', family: 4 })
    const cb = vi.fn()
    lookup('example.com', { all: true, family: 0, hints: 0 }, cb)
    expect(cb).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
  })

  it('responds with the legacy 3-arg form when options.all is false or missing', () => {
    const lookup = createPinnedLookup({ address: '93.184.216.34', family: 4 })
    const cb = vi.fn()
    lookup('example.com', { family: 4 }, cb)
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  })

  it('tolerates the 2-arg form where the callback is passed as options', () => {
    const lookup = createPinnedLookup({ address: '2606:4700:4700::1111', family: 6 })
    const cb = vi.fn()
    lookup('example.com', cb)
    expect(cb).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6)
  })
})

describe('readResponseTextWithLimit', () => {
  it('stops reading after the configured byte limit', async () => {
    const result = await readResponseTextWithLimit(new Response('abcdef'), 3)
    expect(result).toEqual({ text: 'abc', truncated: true })
  })
})

describe('SMOKE_LOOPBACK_TARGET allowlist', () => {
  const enableSmoke = () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:41300'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234'
  }
  afterEach(() => {
    delete process.env.SMOKE_MODE
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.SMOKE_LOOPBACK_TARGET
  })

  it('unset: loopback is still rejected (default-off, no behavior change)', async () => {
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('set + smoke mode: the EXACT authority is permitted', async () => {
    enableSmoke()
    const url = await assertSafeHttpUrl('http://127.0.0.1:41234/audit-target')
    expect(url.host).toBe('127.0.0.1:41234')
  })
  it('set but NOT smoke mode: still rejected (fail closed)', async () => {
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234'
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('smoke mode but NON-loopback app base URL: rejected', async () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'https://seo.example.com'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1:41234'
    await expect(assertSafeHttpUrl('http://127.0.0.1:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('set: a DIFFERENT loopback port is still rejected', async () => {
    enableSmoke()
    await expect(assertSafeHttpUrl('http://127.0.0.1:9999/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('set: private (non-loopback) and link-local hosts still rejected', async () => {
    enableSmoke()
    await expect(assertSafeHttpUrl('http://10.0.0.5:41234/')).rejects.toBeInstanceOf(SafeUrlError)
    await expect(assertSafeHttpUrl('http://169.254.169.254:41234/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('portless target env is refused (no implicit port 80)', async () => {
    process.env.SMOKE_MODE = 'true'
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:41300'
    process.env.SMOKE_LOOPBACK_TARGET = '127.0.0.1'
    await expect(assertSafeHttpUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SafeUrlError)
  })
  it('parseSafeHttpUrl honors the same exact-authority allowance', () => {
    enableSmoke()
    const u = parseSafeHttpUrl('http://127.0.0.1:41234/x')
    expect(u.host).toBe('127.0.0.1:41234')
  })
})

describe('SafeUrlError.reason', () => {
  it('defaults to policy', () => {
    expect(new SafeUrlError('nope').reason).toBe('policy')
    expect(new SafeUrlError('nope').name).toBe('SafeUrlError')
  })

  it('carries an explicit reason', () => {
    expect(new SafeUrlError('gone', 'dns').reason).toBe('dns')
    expect(new SafeUrlError('loop', 'redirect').reason).toBe('redirect')
    expect(new SafeUrlError('bad', 'invalid-response').reason).toBe('invalid-response')
  })

  it('tags DNS resolution failure with reason dns', async () => {
    const lookup = async () => { throw new Error('ENOTFOUND') }
    await expect(
      assertSafeHttpUrl('https://does-not-resolve.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'dns' })
  })

  it('tags empty DNS results with reason dns', async () => {
    const lookup = async () => []
    await expect(
      assertSafeHttpUrl('https://empty-dns.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'dns' })
  })

  it('keeps policy reason for private-address rejection', async () => {
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }]
    await expect(
      assertSafeHttpUrl('https://internal.example', { lookup })
    ).rejects.toMatchObject({ name: 'SafeUrlError', reason: 'policy' })
  })
})
