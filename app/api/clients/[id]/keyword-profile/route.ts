import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { getKeywordProfile, updateKeywordProfile } from '@/lib/services/keyword-profile'
import { INSTITUTION_TYPES, validatePrograms, type InstitutionType } from '@/lib/keywords/program-roster'
import { validateProfileLocale } from '@/lib/keywords/locales'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * GET /api/clients/:id/keyword-profile
 * → { institutionType, programs, suggestions, locale, hasLiveScan } (KS-3 spec §6).
 * Cookie-gated by global middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  const profile = await getKeywordProfile(clientId)
  if (!profile) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })
  return NextResponse.json(profile)
})

/**
 * PATCH /api/clients/:id/keyword-profile
 * Any subset of { institutionType, programs, locale } — plus mutually
 * exclusive convenience ops confirmSuggestion / dismissSuggestion (a body
 * mixing ops with `programs`, or both ops, is 400 conflicting_ops —
 * KS3-Codex #5). Locale is validated via validateProfileLocale (bare
 * two-letter language only — KS3-Codex #2). LWW on whole columns; the UI
 * refetches after every mutation. Cookie-gated by global middleware.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })

  const raw = await parseJsonBody(request)
  // parseJsonBody returns any valid JSON — null/array/primitive would make
  // `'programs' in body` throw a 500 (plan-Codex #4).
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const body = raw as Record<string, unknown>

  const hasPrograms = 'programs' in body
  const hasConfirm = body.confirmSuggestion != null
  const hasDismiss = body.dismissSuggestion != null
  if ((hasConfirm && hasDismiss) || (hasPrograms && (hasConfirm || hasDismiss))) {
    return NextResponse.json({ error: 'conflicting_ops' }, { status: 400 })
  }

  const patch: Parameters<typeof updateKeywordProfile>[1] = {}

  if ('institutionType' in body) {
    const t = body.institutionType
    if (t !== null && !INSTITUTION_TYPES.includes(t as InstitutionType)) {
      return NextResponse.json({ error: 'invalid_institution_type' }, { status: 400 })
    }
    patch.institutionType = t as InstitutionType | null
  }
  if (hasPrograms) {
    const v = validatePrograms(body.programs)
    if (!v.ok) return NextResponse.json({ error: 'invalid_programs', reason: v.reason }, { status: 400 })
    patch.programs = v.programs
  }
  if ('locale' in body) {
    if (body.locale === null) {
      patch.locale = null
    } else {
      const loc = validateProfileLocale(body.locale)
      if (!loc) return NextResponse.json({ error: 'invalid_locale' }, { status: 400 })
      const marketLabel = (body.locale as Record<string, unknown>).marketLabel
      patch.locale = { ...loc, marketLabel: typeof marketLabel === 'string' ? marketLabel.slice(0, 100) : null }
    }
  }
  if (hasConfirm) {
    if (typeof body.confirmSuggestion !== 'string' || !body.confirmSuggestion.trim()) {
      return NextResponse.json({ error: 'invalid_suggestion_name' }, { status: 400 })
    }
    patch.confirmSuggestion = body.confirmSuggestion
  }
  if (hasDismiss) {
    if (typeof body.dismissSuggestion !== 'string' || !body.dismissSuggestion.trim()) {
      return NextResponse.json({ error: 'invalid_suggestion_name' }, { status: 400 })
    }
    patch.dismissSuggestion = body.dismissSuggestion
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_valid_fields' }, { status: 400 })
  }

  const result = await updateKeywordProfile(clientId, patch)
  if (!result.ok) {
    const status = result.error === 'client_not_found' ? 404 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result.profile)
})
