// lib/tools-registry.test.ts
import { describe, it, expect } from 'vitest'
import { TOOLS, NAV_GROUPS, toolForPathname } from './tools-registry'
import { isPublicPath } from '@/middleware'

describe('tools registry', () => {
  it('has unique ids and internal hrefs', () => {
    const ids = TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TOOLS) {
      expect(t.href.startsWith('/')).toBe(true)
      for (const c of t.children ?? []) expect(c.href.startsWith('/')).toBe(true)
    }
  })

  it('every tool group exists in NAV_GROUPS or is footer', () => {
    const groupIds = new Set(NAV_GROUPS.map((g) => g.id))
    for (const t of TOOLS) {
      expect(t.group === 'footer' || groupIds.has(t.group)).toBe(true)
    }
  })

  // Codex fix 1 drift test: no registry destination may be a public path —
  // registry hrefs live inside the (app) shell; public pages have no nav entry.
  it('no registry href is a public path', () => {
    for (const t of TOOLS) {
      expect(isPublicPath(t.href), t.href).toBe(false)
      for (const c of t.children ?? []) expect(isPublicPath(c.href), c.href).toBe(false)
    }
  })

  it('toolForPathname matches longest prefix, exact for home', () => {
    expect(toolForPathname('/')!.id).toBe('home')
    expect(toolForPathname('/ada-audit/queue')!.id).toBe('site-audit')
    expect(toolForPathname('/seo-parser/results/abc')!.id).toBe('seo-parser')
    expect(toolForPathname('/clients/12')!.id).toBe('clients')
    expect(toolForPathname('/nonexistent')).toBeUndefined()
  })

  it('hidden tools resolve for titles but are flagged out of the nav', () => {
    const kw = toolForPathname('/keyword-research/abc123')
    expect(kw?.name).toBe('Keyword Research')
    expect(kw?.hidden).toBe(true)
    expect(toolForPathname('/pillar-analysis/9')?.hidden).toBe(true)
  })
})
