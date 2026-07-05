import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

// 404-only characterization (per Task 1 brief / plan exemplar D): no
// SCREENSHOTS_DIR success fixture is set up here. The 200 image-served path
// is left to manual/integration coverage.

const params = (auditId: string, filename: string) => ({ params: Promise.resolve({ auditId, filename }) })

describe('GET /api/ada-audit/screenshots/[auditId]/[filename]', () => {
  it('404s when auditId fails the traversal allowlist', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/screenshots/x/x.png'), params('../etc', 'x.png'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('404s when filename fails the traversal allowlist', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/screenshots/x/x.png'), params('validid', '../../etc/passwd'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('404s when filename does not end in .png', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ada-audit/screenshots/x/x.png'), params('validid', 'x.txt'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('404 Not found when the file is absent (allowlist-valid but no file on disk)', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/ada-audit/screenshots/x/x.png'),
      params('__a3ada__nonexistent-audit-id', 'nonexistent-file.png'),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })
})
