// C18: bounded pattern-sample loader for the site-wide-patterns dropdown.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ prisma: { adaAudit: { findUnique: vi.fn() } } }))
vi.mock('@/lib/ada-audit/findings-fallback', () => ({ buildArchivedAxeResults: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { buildArchivedAxeResults } = await import('@/lib/ada-audit/findings-fallback')
const { GET } = await import('./route')

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (id: string, qs: string) => new NextRequest(`http://localhost/api/site-audit/${id}/pattern-sample?${qs}`)

beforeEach(() => {
  vi.mocked(prisma.adaAudit.findUnique).mockReset()
  vi.mocked(buildArchivedAxeResults).mockReset()
})

describe('GET /api/site-audit/[id]/pattern-sample (C18)', () => {
  it('400s when rule or page is missing', async () => {
    const res = await GET(req('sa1', 'rule=image-alt'), params('sa1'))
    expect(res.status).toBe(400)
  })

  it('400s when rule fails the id shape', async () => {
    const res = await GET(req('sa1', 'rule=bad rule!&page=' + encodeURIComponent('https://x.test/a')), params('sa1'))
    expect(res.status).toBe(400)
  })

  it('extracts deduped nodes for the rule from the representative child blob', async () => {
    vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue({
      id: 'child1',
      result: JSON.stringify({ violations: [{ id: 'image-alt', nodes: [
        { html: '<img>', target: ['img.a'], screenshotPath: 'image-alt-0.png' },
        { html: '<img>', target: ['img.a'] }, // dup of first by target
        { html: '<img2>', target: ['img.b'] },
      ] }] }),
    } as never)
    const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/a')), params('sa1'))
    const body = await res.json()
    expect(body.found).toBe(true)
    expect(body.childAuditId).toBe('child1')
    expect(body.archived).toBe(false)
    expect(body.nodes).toHaveLength(2)
    expect(body.nodes[0].screenshotPath).toBe('image-alt-0.png')
  })

  it('degrades to the archived capped sample when the blob is pruned', async () => {
    vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue({ id: 'child2', result: null } as never)
    vi.mocked(buildArchivedAxeResults).mockResolvedValue({
      archived: true,
      violations: [{ id: 'image-alt', nodes: [{ html: '<img>', target: ['img.a'] }] }],
    } as never)
    const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/a')), params('sa1'))
    const body = await res.json()
    expect(body.archived).toBe(true)
    expect(body.nodes[0].screenshotPath).toBeNull()
  })

  it('found:false when no child page matches', async () => {
    vi.mocked(prisma.adaAudit.findUnique).mockResolvedValue(null as never)
    const res = await GET(req('sa1', 'rule=image-alt&page=' + encodeURIComponent('https://x.test/missing')), params('sa1'))
    const body = await res.json()
    expect(body.found).toBe(false)
    expect(body.nodes).toEqual([])
  })
})
