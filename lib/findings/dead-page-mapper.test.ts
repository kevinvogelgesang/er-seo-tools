import { describe, it, expect } from 'vitest'
import { mapDeadPageFindings } from './dead-page-mapper'
import type { CrawlPageInput } from './types'

function fakeEnsurePage() {
  const pages: CrawlPageInput[] = []
  const ensurePage = (url: string) => {
    let page = pages.find((candidate) => candidate.url === url)
    if (!page) {
      page = { id: `p-${pages.length}`, runId: 'r1', url } as CrawlPageInput
      pages.push(page)
    }
    return page
  }
  return { ensurePage, pages }
}

describe('mapDeadPageFindings', () => {
  it('emits one page finding per dead url plus one run finding with the distinct-url count', () => {
    const { ensurePage } = fakeEnsurePage()
    const findings = mapDeadPageFindings(
      [
        { url: 'https://x.edu/a', statusCode: 404 },
        { url: 'https://x.edu/b', statusCode: 410 },
      ],
      { runId: 'r1', ensurePage, affectedComplete: true },
    )

    const runFindings = findings.filter((finding) => finding.scope === 'run')
    const pageFindings = findings.filter((finding) => finding.scope === 'page')

    expect(runFindings).toHaveLength(1)
    expect(runFindings[0]).toMatchObject({
      type: 'dead_page',
      scope: 'run',
      count: 2,
      severity: 'warning',
    })
    expect(pageFindings).toHaveLength(2)
    expect(JSON.parse(pageFindings[0].detail!)).toMatchObject({ statusCode: 404 })
  })

  it('leaves CrawlPage.statusCode null so dead pages do not inflate observed coverage', () => {
    const { ensurePage, pages } = fakeEnsurePage()

    mapDeadPageFindings(
      [{ url: 'https://x.edu/a', statusCode: 404 }],
      { runId: 'r1', ensurePage, affectedComplete: true },
    )

    expect(pages[0].statusCode ?? null).toBeNull()
  })

  it('returns no findings for an empty set of dead pages', () => {
    const { ensurePage } = fakeEnsurePage()

    expect(mapDeadPageFindings([], { runId: 'r1', ensurePage, affectedComplete: true })).toHaveLength(0)
  })
})
