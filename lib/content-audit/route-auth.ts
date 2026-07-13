// lib/content-audit/route-auth.ts
// Facade over lib/handoff/route-auth.ts (D1 Task 9): requireContentAuditToken
// now delegates to requireHandoffToken(req, 'cat', siteAuditId, scope), mapping
// the shared helper's {ok:false,response} to this module's own {ok:false,res}
// shape so the three public cat_ routes (manifest/page/findings) don't need
// to change. Still maps every failure to a controlled 401/response — never a
// raw throw that would surface as withRoute's 500 internal_error.
import { NextRequest } from 'next/server'
import { verifyContentAuditToken, CONTENT_AUDIT_TOKEN_SCOPES } from '../content-audit-token'
import { requireHandoffToken } from '../handoff/route-auth'

type Scope = (typeof CONTENT_AUDIT_TOKEN_SCOPES)[number]
type Result = { ok: true; payload: Awaited<ReturnType<typeof verifyContentAuditToken>> } | { ok: false; res: Response }

export async function requireContentAuditToken(req: NextRequest, siteAuditId: string, scope: Scope): Promise<Result> {
  const result = await requireHandoffToken(req, 'cat', siteAuditId, scope)
  if (!result.ok) {
    return { ok: false, res: result.response }
  }
  return { ok: true, payload: result.payload as Awaited<ReturnType<typeof verifyContentAuditToken>> }
}
