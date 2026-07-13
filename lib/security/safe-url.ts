import { promises as dns } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_REDIRECTS = 5
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
])

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
]

/** Classification for SafeUrlError causes. 'policy' = the SSRF guard itself
 *  rejected the request (private host, credentials, scheme, invalid URL);
 *  the others distinguish operational failures that are NOT policy blocks so
 *  callers (lib/seo-fetch, D4 checks) can report them truthfully. Additive
 *  only — never changes what throws. */
export type SafeUrlErrorReason = 'policy' | 'dns' | 'redirect' | 'invalid-response'

export class SafeUrlError extends Error {
  readonly reason: SafeUrlErrorReason
  constructor(message: string, reason: SafeUrlErrorReason = 'policy') {
    super(message)
    this.name = 'SafeUrlError'
    this.reason = reason
  }
}

// Test-only, default-OFF loopback allowance for the Playwright smoke suite.
// Honored ONLY in smoke mode (SMOKE_MODE=true + loopback NEXT_PUBLIC_APP_URL) so
// a normal deployed app (public base URL, no SMOKE_MODE) never honors it; and
// instrumentation.ts refuses to boot if it is set outside smoke mode. It can
// never widen SSRF in production; the worst a misconfig reaches is one
// self-loopback port during a smoke run. Unset -> byte-identical behavior.
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}
function parseLoopbackAuthority(value: string): { host: string } | null {
  let u: URL
  try { u = new URL('http://' + value) } catch { return null }
  if (!u.port) return null
  if (!isLoopbackHostname(u.hostname)) return null
  if (u.pathname !== '/' && u.pathname !== '') return null
  return { host: u.host }
}
function smokeModeActive(): boolean {
  if (process.env.SMOKE_MODE !== 'true') return false
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return false
  try { return isLoopbackHostname(new URL(base).hostname) } catch { return false }
}
export function allowlistedSmokeAuthority(parsed: URL): boolean {
  if (!smokeModeActive()) return false
  const target = process.env.SMOKE_LOOPBACK_TARGET
  if (!target) return false
  const allowed = parseLoopbackAuthority(target)
  return allowed !== null && parsed.host === allowed.host
}

export type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family?: number }>>

export interface ResolvedSafeHttpUrl {
  url: URL
  addresses: Array<{ address: string; family: 4 | 6 }>
}

export interface SafeUrlOptions {
  lookup?: DnsLookup
}

export interface SafeFetchOptions extends SafeUrlOptions {
  maxRedirects?: number
  transport?: (
    url: URL,
    init: RequestInit | undefined,
    resolved: ResolvedSafeHttpUrl
  ) => Promise<Response>
}

export interface SafeFetchResult {
  response: Response
  url: string
  redirects: string[]
}

export interface LimitedTextResult {
  text: string
  truncated: boolean
}

const defaultLookup: DnsLookup = async (hostname, options) => {
  const result = await dns.lookup(hostname, options)
  return result as Array<{ address: string; family?: number }>
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  return normalized.replace(/\.$/, '')
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : Number.NaN
  })

  return bytes.every(Number.isInteger) ? bytes : null
}

function normalizeIpv4MappedIpv6(address: string): string {
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) {
    return lower.slice('::ffff:'.length)
  }
  return address
}

export function isPrivateOrInternalAddress(address: string): boolean {
  const normalized = normalizeIpv4MappedIpv6(normalizeHostname(address))
  const ipVersion = isIP(normalized)

  if (ipVersion === 4) {
    const bytes = parseIpv4(normalized)
    if (!bytes) return true
    const [a, b, c] = bytes
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }

  if (ipVersion === 6) {
    const lower = normalized.toLowerCase()
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('ff') ||
      lower.startsWith('100:') ||
      lower.startsWith('2001:db8')
    )
  }

  return true
}

function assertPublicHostname(hostname: string): string {
  const normalized = normalizeHostname(hostname)
  if (!normalized) {
    throw new SafeUrlError('URL must include a hostname')
  }

  if (BLOCKED_HOSTNAMES.has(normalized) || BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    throw new SafeUrlError('Requests to private/internal hosts are not allowed')
  }

  if (isIP(normalized) && isPrivateOrInternalAddress(normalized)) {
    throw new SafeUrlError('Requests to private/internal addresses are not allowed')
  }

  if (!isIP(normalized) && !normalized.includes('.')) {
    throw new SafeUrlError('Requests to internal hostnames are not allowed')
  }

  return normalized
}

export function parseSafeHttpUrl(input: string | URL): URL {
  let parsed: URL
  try {
    parsed = input instanceof URL ? new URL(input.toString()) : new URL(input)
  } catch {
    throw new SafeUrlError('Invalid URL')
  }

  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new SafeUrlError('Only http/https URLs allowed')
  }

  if (parsed.username || parsed.password) {
    throw new SafeUrlError('URL credentials are not allowed')
  }

  if (allowlistedSmokeAuthority(parsed)) return parsed

  assertPublicHostname(parsed.hostname)
  return parsed
}

export async function assertSafeHttpUrl(input: string | URL, options?: SafeUrlOptions): Promise<URL> {
  return (await resolveSafeHttpUrl(input, options)).url
}

async function resolveSafeHttpUrl(input: string | URL, options?: SafeUrlOptions): Promise<ResolvedSafeHttpUrl> {
  const parsed = parseSafeHttpUrl(input)

  if (allowlistedSmokeAuthority(parsed)) {
    return { url: parsed, addresses: [{ address: '127.0.0.1', family: 4 }] }
  }

  const hostname = assertPublicHostname(parsed.hostname)

  if (isIP(hostname)) {
    if (isPrivateOrInternalAddress(hostname)) {
      throw new SafeUrlError('Requests to private/internal addresses are not allowed')
    }
    return {
      url: parsed,
      addresses: [{ address: hostname, family: isIP(hostname) as 4 | 6 }],
    }
  }

  const lookup = options?.lookup ?? defaultLookup
  let addresses: Array<{ address: string; family?: number }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new SafeUrlError(`Could not resolve hostname: ${hostname}`, 'dns')
  }

  if (addresses.length === 0) {
    throw new SafeUrlError(`Could not resolve hostname: ${hostname}`, 'dns')
  }

  if (addresses.some(({ address }) => isPrivateOrInternalAddress(address))) {
    throw new SafeUrlError('Requests to private/internal addresses are not allowed')
  }

  return {
    url: parsed,
    addresses: addresses.map(({ address, family }) => {
      const detectedFamily = family === 4 || family === 6 ? family : isIP(address)
      if (detectedFamily !== 4 && detectedFamily !== 6) {
        throw new SafeUrlError('Hostname resolved to an invalid address')
      }
      return { address, family: detectedFamily }
    }),
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  new Headers(headers).forEach((value, key) => {
    result[key] = value
  })
  return result
}

function responseHeadersFromIncoming(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result.append(key, value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item)
      }
    }
  }
  return result
}

function bodyToRequestPayload(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (!body) return undefined
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  throw new SafeUrlError('Unsupported request body type')
}

/**
 * Builds a `lookup` callback for node:http(s).request that always returns the
 * pre-resolved, SSRF-validated address. Supports both signatures node:net may
 * invoke a lookup with:
 *
 *  - Legacy form:   `(err, address, family)` — when options.all is not set
 *  - "All" form:    `(err, [{ address, family }, ...])` — used by Node 20+'s
 *    Socket when `autoSelectFamily` is enabled (the default since Node 20).
 *
 * Returning the legacy form when Node wanted the array form makes node:net
 * try to read `.address` off a string, surfacing as
 * `TypeError [ERR_INVALID_IP_ADDRESS]: Invalid IP address: undefined` and
 * silently breaking every fetch. Exported for unit testing.
 */
export function createPinnedLookup(address: { address: string; family: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((_hostname: string, options: any, callback: any) => {
    // Older callers may pass the callback as the second argument; tolerate that.
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'object' && options !== null ? options : undefined
    const wantsAll = opts && opts.all === true
    if (wantsAll) {
      cb(null, [{ address: address.address, family: address.family }])
    } else {
      cb(null, address.address, address.family)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

/**
 * True when `status` is within the range the WHATWG `Response` constructor
 * accepts (200-599 inclusive). Out-of-range codes — LinkedIn's anti-bot 999,
 * stray 1xx, malformed CDN responses — make `new Response(..., { status })`
 * throw RangeError. The transport screens them for a typed, provably-attributed
 * SafeUrlError; the callback-wide try/catch in fetchWithPinnedAddress is the
 * actual settle guarantee.
 */
export function isConstructibleResponseStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status <= 599
}

// Idle-socket ceiling for the real transport: a host that accepts the TCP/TLS
// connection but then goes silent (tarpit) would otherwise leave the promise
// pending forever for callers that pass no AbortSignal (pdf-runner's fetchOnce).
// This is an inactivity timeout, not a total-duration budget — slow-but-flowing
// downloads are unaffected.
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/**
 * The real safeFetch transport. Exported for unit testing only (like
 * createPinnedLookup) — it performs NO address validation itself (that lives in
 * resolveSafeHttpUrl), which is exactly what lets tests drive it against a
 * loopback server. Production code must go through safeFetch.
 */
export async function fetchWithPinnedAddress(
  url: URL,
  init: RequestInit | undefined,
  resolved: ResolvedSafeHttpUrl,
  idleTimeoutMs: number = SOCKET_IDLE_TIMEOUT_MS
): Promise<Response> {
  const address = resolved.addresses[0]
  const body = bodyToRequestPayload(init?.body)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const signal = init?.signal ?? undefined

  if (signal?.aborted) {
    throw new Error('Request aborted')
  }

  return await new Promise<Response>((resolve, reject) => {
    let settled = false
    const req = request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
      headers: headersToObject(init?.headers),
      lookup: createPinnedLookup(address),
    }, (res) => {
      // This callback runs on a later tick, so a synchronous throw here is NOT
      // caught by the Promise constructor — it escapes and the promise never
      // settles (the 2026-07-06 verifier hang: LinkedIn's 999 made
      // `new Response` throw RangeError after `settled` was set). fail() + the
      // callback-wide try/catch make settlement structural: every path through
      // this callback resolves or rejects.
      const fail = (err: Error) => {
        settled = true
        reject(err)
        res.destroy()
      }
      try {
        const status = res.statusCode
        if (!status) {
          // Deterministic for this response — SafeUrlError so callers classify
          // it as terminal instead of retrying an identical doomed request.
          return fail(new SafeUrlError('Response missing status code', 'invalid-response'))
        }
        if (!isConstructibleResponseStatus(status)) {
          return fail(new SafeUrlError(`Unsupported response status: ${status}`, 'invalid-response'))
        }
        const resBody = status === 204 || status === 205 || status === 304
          ? null
          : Readable.toWeb(res) as ReadableStream<Uint8Array>
        if (!resBody) res.resume()
        const response = new Response(resBody, {
          status,
          statusText: res.statusMessage,
          headers: responseHeadersFromIncoming(res.headers),
        })
        settled = true
        resolve(response)
      } catch (err) {
        // Response construction failed (statusText/header edge case). Also
        // deterministic — same doomed request on retry.
        fail(new SafeUrlError(
          `Response construction failed: ${err instanceof Error ? err.message : String(err)}`,
          'invalid-response'
        ))
      }
    })

    req.setTimeout(idleTimeoutMs, () => {
      req.destroy(new Error('Socket idle timeout'))
    })

    const abort = () => {
      req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Request aborted'))
    }

    signal?.addEventListener('abort', abort, { once: true })

    req.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    req.on('close', () => {
      signal?.removeEventListener('abort', abort)
    })

    if (body) {
      req.end(body)
    } else {
      req.end()
    }
  })
}

export async function safeFetch(
  input: string | URL,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<SafeFetchResult> {
  let current = await resolveSafeHttpUrl(input, options)
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS
  const transport = options?.transport ?? fetchWithPinnedAddress
  const redirects: string[] = []

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await transport(current.url, {
      ...init,
      redirect: 'manual',
    }, current)

    if (!isRedirectStatus(response.status)) {
      return {
        response,
        url: current.url.toString(),
        redirects,
      }
    }

    // Drop the redirect response's unread body now — otherwise its socket is
    // held until the caller's abort signal fires (or indefinitely without one).
    void response.body?.cancel().catch(() => {})

    const location = response.headers.get('location')
    if (!location) {
      throw new SafeUrlError('Redirect response missing Location header', 'redirect')
    }

    if (redirectCount === maxRedirects) {
      throw new SafeUrlError('Too many redirects', 'redirect')
    }

    const redirectedUrl = new URL(location, current.url)
    current = await resolveSafeHttpUrl(redirectedUrl, options)
    redirects.push(current.url.toString())
  }

  throw new SafeUrlError('Too many redirects', 'redirect')
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    return { bytes: new Uint8Array(), truncated: false }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const remaining = maxBytes - totalBytes
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining))
          totalBytes += remaining
        }
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }

      chunks.push(value)
      totalBytes += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { bytes, truncated }
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES
): Promise<LimitedTextResult> {
  const { bytes, truncated } = await readResponseBytesWithLimit(response, maxBytes)
  return {
    text: new TextDecoder().decode(bytes),
    truncated,
  }
}
