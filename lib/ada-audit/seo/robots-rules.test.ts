import { describe, it, expect } from 'vitest'
import { parseRobots, isAllowed } from './robots-rules'

describe('parseRobots', () => {
  it('collects only the User-agent: * group', () => {
    const r = parseRobots(
      'User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\n'
    )
    expect(r.disallow).toEqual(['/admin'])
    expect(r.allow).toEqual(['/admin/public'])
  })

  it('ignores comments, blank lines, and empty Disallow', () => {
    const r = parseRobots('User-agent: *\n# comment\nDisallow:\nDisallow: /x\n')
    expect(r.disallow).toEqual(['/x'])
  })

  it('returns empty rules when no * group exists', () => {
    expect(parseRobots('User-agent: Bingbot\nDisallow: /')).toEqual({ disallow: [], allow: [] })
  })

  it('honors a group that lists * alongside another agent (Codex #10)', () => {
    // Consecutive User-agent lines share the following rules; if any is *, the group applies to us.
    const r = parseRobots('User-agent: Googlebot\nUser-agent: *\nDisallow: /shared\n')
    expect(r.disallow).toEqual(['/shared'])
  })
})

describe('isAllowed', () => {
  const r = { disallow: ['/admin', '/tmp/'], allow: ['/admin/public'] }
  it('blocks a disallowed prefix', () => expect(isAllowed('/admin/settings', r)).toBe(false))
  it('allows an Allow override that is at least as long', () =>
    expect(isAllowed('/admin/public/page', r)).toBe(true))
  it('allows an unmatched path', () => expect(isAllowed('/programs', r)).toBe(true))
  it('supports $ end-anchor', () =>
    expect(isAllowed('/x.php', { disallow: ['/*.php$'], allow: [] })).toBe(false))
  it('supports * wildcard', () =>
    expect(isAllowed('/a/b/c', { disallow: ['/a/*/c'], allow: [] })).toBe(false))
  it('allow-all on empty rules', () => expect(isAllowed('/anything', { disallow: [], allow: [] })).toBe(true))
})
