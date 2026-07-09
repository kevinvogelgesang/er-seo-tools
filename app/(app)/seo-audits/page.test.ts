import { describe, expect, it } from 'vitest'
import SeoAuditsIndexPage from './page'

describe('/seo-audits index (C16)', () => {
  it('permanent-redirects (308) to /ada-audit', () => {
    let digest = ''
    try {
      SeoAuditsIndexPage()
    } catch (e) {
      digest = (e as { digest?: string }).digest ?? ''
    }
    expect(digest).toContain('NEXT_REDIRECT')
    expect(digest).toContain('/ada-audit')
    expect(digest).toContain('308')
  })
})
