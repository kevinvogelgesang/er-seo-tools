import { HttpError } from '@/lib/api/errors'
import { isSameSiteRequest } from '@/lib/security/same-site-request'

const WINDOW_MS = 60_000
const MAX_WRITES_PER_WINDOW = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const writesByToken = new Map<string, number[]>()

export function requireSameSite(request: Request): void {
  if (!isSameSiteRequest(request as Parameters<typeof isSameSiteRequest>[0])) {
    throw new HttpError(403, 'cross_site_request_blocked')
  }
}

export function requireJsonContentType(request: Request): void {
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (type !== 'application/json') throw new HttpError(415, 'json_content_type_required')
}

export function checkWriteThrottle(token: string, now = Date.now()): void {
  const cutoff = now - WINDOW_MS
  const recent = (writesByToken.get(token) ?? []).filter((at) => at > cutoff)
  if (recent.length >= MAX_WRITES_PER_WINDOW) {
    writesByToken.set(token, recent)
    throw new HttpError(429, 'rate_limited')
  }
  recent.push(now)
  writesByToken.set(token, recent)
}

export async function readBoundedJson(request: Request, capBytes: number): Promise<unknown> {
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > capBytes) {
        await reader.cancel().catch(() => {})
        throw new HttpError(413, 'request_too_large')
      }
      chunks.push(value)
    }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

export function validateClientMutationId(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new HttpError(400, 'invalid_client_mutation_id')
  }
  return raw.toLowerCase()
}

export function resetWriteThrottleForTests(): void {
  writesByToken.clear()
}
