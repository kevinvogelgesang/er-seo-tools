//
// Pure robots.txt rule matcher for the hybrid-discovery crawl (Increment 2).
// v1 honors the `User-agent: *` group ONLY — the crawler's UA is a full browser
// string (to dodge WAF bot-403s), so there is no custom token to match a
// UA-specific group against. Rules apply to the LINKED crawl frontier only;
// sitemap/seed URLs are kept regardless (continuity: the existing pipeline
// already audits every sitemap URL without consulting Disallow).
// NOTE: this is the MINIMAL crawl-frontier matcher (star-group only, $-aware).
// The UA-aware, issue-reporting validator parser lives in ./robots-parse.ts —
// the two are intentionally distinct (spec D2); do not unify.

export interface RobotsRules {
  disallow: string[]
  allow: string[]
}

export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = []
  const allow: string[] = []
  // A group is a run of consecutive User-agent lines followed by rules.
  // Codex #10: if ANY User-agent line in the current group is `*`, the group
  // applies to us. `prevWasUserAgent` detects group boundaries: a User-agent
  // line right after a rule line starts a NEW group.
  let groupIsStar = false
  let prevWasUserAgent = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (!prevWasUserAgent) groupIsStar = false // a rule line ended the last group → new group
      if (value === '*') groupIsStar = true
      prevWasUserAgent = true
    } else {
      prevWasUserAgent = false
      if (!groupIsStar) continue
      if (field === 'disallow' && value) disallow.push(value)
      else if (field === 'allow' && value) allow.push(value)
    }
  }
  return { disallow, allow }
}

/** Convert a robots path pattern (with * and $) to a RegExp matched at the start of the pathname. */
function toMatcher(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '$') re += '$'
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re)
}

/** Longest-match; an Allow at least as long as the matching Disallow wins. */
export function isAllowed(pathname: string, rules: RobotsRules): boolean {
  let longestDisallow = -1
  for (const p of rules.disallow) {
    if (toMatcher(p).test(pathname)) longestDisallow = Math.max(longestDisallow, p.replace(/[*$]/g, '').length)
  }
  if (longestDisallow === -1) return true
  let longestAllow = -1
  for (const p of rules.allow) {
    if (toMatcher(p).test(pathname)) longestAllow = Math.max(longestAllow, p.replace(/[*$]/g, '').length)
  }
  return longestAllow >= longestDisallow
}
