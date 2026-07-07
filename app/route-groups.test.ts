// app/route-groups.test.ts
// Codex fix 1: the (public)/(app) split must track middleware's isPublicPath.
// Walks the app dir: every page.tsx under (public) must resolve to a public
// URL; every page.tsx under (app) must NOT.
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { isPublicPath } from '@/middleware'

function pagesUnder(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // dynamic segments become a representative literal so isPublicPath can judge the prefix
      const seg = entry.startsWith('[') ? 'x' : entry
      out.push(...pagesUnder(full, `${base}/${seg}`))
    } else if (entry === 'page.tsx') {
      out.push(base === '' ? '/' : base)
    }
  }
  return out
}

describe('route-group split tracks isPublicPath', () => {
  it('every (public) page is public', () => {
    for (const url of pagesUnder('app/(public)')) {
      // trailing-slash variant covers prefix rules like '/share/'
      expect(isPublicPath(url) || isPublicPath(url + '/'), url).toBe(true)
    }
  })
  it('no (app) page is public', () => {
    for (const url of pagesUnder('app/(app)')) {
      expect(isPublicPath(url), url).toBe(false)
    }
  })
})
