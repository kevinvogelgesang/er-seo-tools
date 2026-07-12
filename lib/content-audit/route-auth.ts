// lib/content-audit/route-auth.ts
// One fail-closed auth helper for the three public cat_ routes. Maps every
// failure (missing/prefix-less token, cross-family JWT, sub mismatch, expiry,
// missing scope) to a controlled 401 Response — never a raw throw that would
// surface as withRoute's 500 internal_error.
import { NextRequest, NextResponse } from 'next/server'
import { verifyContentAuditToken, CONTENT_AUDIT_TOKEN_SCOPES } from '../content-audit-token'

type Scope = (typeof CONTENT_AUDIT_TOKEN_SCOPES)[number]
type Result = { ok: true; payload: Awaited<ReturnType<typeof verifyContentAuditToken>> } | { ok: false; res: Response }

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization')
  if (h && h.startsWith('Bearer ')) return h.slice('Bearer '.length).trim()
  return req.nextUrl.searchParams.get('token')
}

export async function requireContentAuditToken(req: NextRequest, siteAuditId: string, scope: Scope): Promise<Result> {
  const token = bearer(req)
  if (!token) return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  let payload
  try {
    payload = await verifyContentAuditToken(token, siteAuditId)
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'auth_required' }, { status: 401 }) }
  }
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : []
  if (!scopes.includes(scope)) {
    return { ok: false, res: NextResponse.json({ error: 'insufficient_scope' }, { status: 401 }) }
  }
  return { ok: true, payload }
}
