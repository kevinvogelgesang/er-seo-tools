// GET  /api/clients/[id]/robots-checks       — history summaries (optional ?domain=)
// POST /api/clients/[id]/robots-checks       — run a check now (body {domain})
//
// Internal UI-facing routes: cookie-gated by the middleware (NOT in
// isPublicPath) — no middleware change. Domain is re-validated server-side
// against the client's registered domains (schedules-route pattern): only
// client-registered domains ever get RobotsCheck rows.
//
// A POST is synchronous (checks are seconds; hard bound ~= 60s budget +
// one 15s in-flight fetch window). Fetch failures are NOT HTTP errors —
// an unreachable domain is a successfully-recorded observation.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { listRobotsChecks, runAndStoreRobotsCheck } from '@/lib/robots-check/service'

type Params = { params: Promise<{ id: string }> }

// Strict id parser (plan-Codex #4): '01', '1.0', '+1', '1e2' all rejected.
function parseClientId(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null
}

function parseClientDomains(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

/** Normalize + membership-check a submitted domain against the client's
 *  registered domains. Returns the normalized domain or an error Response —
 *  GET and POST validate identically (plan-Codex #4). */
function resolveListedDomain(rawDomain: unknown, clientDomains: string): string | NextResponse {
  let domain: string
  try {
    domain = normalizeClientDomain(rawDomain)
  } catch (err) {
    if (err instanceof InvalidDomainError) {
      return NextResponse.json({ error: 'invalid_domain' }, { status: 400 })
    }
    throw err
  }
  if (!parseClientDomains(clientDomains).includes(domain)) {
    return NextResponse.json({ error: 'domain_not_listed' }, { status: 400 })
  }
  return domain
}

export const GET = withRoute(async (request: NextRequest, { params }: Params) => {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { domains: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const rawDomain = request.nextUrl.searchParams.get('domain')
  let domain: string | undefined
  if (rawDomain !== null) {
    const resolved = resolveListedDomain(rawDomain, client.domains)
    if (resolved instanceof NextResponse) return resolved
    domain = resolved
  }
  return NextResponse.json({ checks: await listRobotsChecks(clientId, domain) })
})

export const POST = withRoute(async (request: NextRequest, { params }: Params) => {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })

  // unknown, not Record: a JSON `null` body must fall through to
  // invalid_domain, not throw into a 500 (plan-Codex #4).
  const body = await parseJsonBody<unknown>(request)
  const rawDomain = body && typeof body === 'object' ? (body as Record<string, unknown>).domain : undefined

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { archivedAt: true, domains: true },
  })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (client.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })

  const resolved = resolveListedDomain(rawDomain, client.domains)
  if (resolved instanceof NextResponse) return resolved

  const stored = await runAndStoreRobotsCheck(clientId, resolved, { source: 'manual' })
  return NextResponse.json(stored)
})
