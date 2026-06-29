// Origin / Fetch-Metadata guard for cookie-authenticated mutating requests.
//
// Generalized from the logout handler's original inline check so one
// implementation guards every mutating cookie-authed route (enforced centrally
// in middleware.ts). This is CSRF defense-in-depth: the auth cookie is already
// SameSite=Lax and JSON requests trigger a CORS preflight, but an explicit
// same-site check costs nothing and matters more once user OAuth lands.
//
// Edge-runtime safe: reads request headers/url only, no Node APIs.

import type { NextRequest } from 'next/server'

const SAFE_FETCH_SITES = new Set(['same-origin', 'same-site', 'none'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Origins we treat as our own: the request's own origin + NEXT_PUBLIC_APP_URL. */
export function trustedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([new URL(request.url).origin])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin)
    } catch {
      // Malformed deployment URL — startup/config checks cover env mistakes.
    }
  }
  return origins
}

/**
 * True when the request is same-site (safe to mutate). A missing Origin header
 * is allowed (same-origin navigations/form posts and non-browser clients often
 * omit it — and a non-browser caller can't be CSRF'd). Only an explicitly
 * cross-site `Sec-Fetch-Site` or an untrusted `Origin` is rejected.
 */
export function isSameSiteRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (secFetchSite && !SAFE_FETCH_SITES.has(secFetchSite)) {
    return false
  }

  const origin = request.headers.get('origin')
  if (!origin) return true

  return trustedOrigins(request).has(origin)
}

/** State-changing HTTP methods that warrant the same-site check. */
export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase())
}
