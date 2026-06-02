export interface NormalizedUrl {
  scheme: string;
  host: string;       // lowercased; '' if unparseable
  path: string;       // case preserved; '' if unparseable
  query?: string;     // non-UTM query, original order; undefined if none
  originalUrl?: string; // present when UTM stripped or parse failed
}

const UTM_RE = /^utm_/i;

export function normalizeUrl(input: string): NormalizedUrl {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { scheme: '', host: '', path: '', originalUrl: input };
  }
  const kept: string[] = [];
  let strippedAny = false;
  for (const [k, v] of u.searchParams.entries()) {
    if (UTM_RE.test(k)) { strippedAny = true; continue; }
    kept.push(`${k}=${v}`);
  }
  const query = kept.length ? kept.join('&') : undefined;
  return {
    scheme: u.protocol.replace(/:$/, '').toLowerCase(),
    host: u.host.toLowerCase(),
    path: u.pathname,
    query,
    originalUrl: strippedAny ? input : undefined,
  };
}

/**
 * Canonical key for joining the same page across tools (e.g. Screaming Frog vs SEMRush),
 * which often disagree on scheme (http/https) and trailing slash. Ignores scheme and trailing
 * slash, lowercases host, drops UTM params (via normalizeUrl), keeps non-UTM query.
 * Unparseable input falls back to a trimmed/lowercased best-effort key.
 */
export function urlJoinKey(input: string): string {
  const n = normalizeUrl(input);
  if (!n.host) return input.trim().toLowerCase();
  const path = n.path.replace(/\/+$/, '') || '/';
  const query = n.query ? `?${n.query}` : '';
  return `${n.host}${path}${query}`;
}
