export type RedirectDetectResult =
  | { kind: 'audited' }
  | { kind: 'redirected'; finalUrl: string }

// Normalize a URL for redirect-comparison purposes.
// Protocol is ignored (treat http/https as equivalent), default ports
// stripped, trailing slash stripped, fragment stripped, host lowercased,
// www preserved (treat www.x.com vs x.com as different), query preserved.
export function normalizeForRedirect(input: string): string {
  let u: URL
  try { u = new URL(input) } catch { return input }
  const host = u.hostname.toLowerCase()
  const isDefaultPort = (u.port === '' || u.port === '80' || u.port === '443')
  const port = isDefaultPort ? '' : `:${u.port}`
  let pathname = u.pathname
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
  // Strip both protocols by collapsing to a synthetic scheme.
  return `norm://${host}${port}${pathname}${u.search}`
}

// chain: response.request().redirectChain() from puppeteer — we only need
// to know whether it's empty or not. Element shape is opaque.
export function detectRedirect(
  requestedUrl: string,
  redirectChain: unknown[],
  finalUrlRaw: string,
): RedirectDetectResult {
  if (redirectChain.length === 0) return { kind: 'audited' }
  const a = normalizeForRedirect(requestedUrl)
  const b = normalizeForRedirect(finalUrlRaw)
  if (a === b) return { kind: 'audited' }
  return { kind: 'redirected', finalUrl: finalUrlRaw }
}
