import { describe, it, expect } from 'vitest'
import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
import { buildRobotsChangeEmail } from './robots-change-content'

function emptySummary(overrides: Partial<RobotsChangeSummary> = {}): RobotsChangeSummary {
  return {
    robotsStatus: null, robotsContentChanged: false, robotsDiff: null,
    blockedBots: null, sitemaps: null, sitemapUrlTotal: null, counts: null,
    ...overrides,
  }
}

const base = { clientName: 'Acme College', clientId: 7, domain: 'acme.edu', currFailure: null as string | null, appUrl: 'https://seo.example.com' as string | null }

describe('buildRobotsChangeEmail', () => {
  it('subject names the domain', () => {
    const { subject } = buildRobotsChangeEmail({ ...base, summary: emptySummary({ robotsContentChanged: true }) })
    expect(subject).toBe('Robots/sitemap change: acme.edu')
  })

  it('escapes hostile robots lines in the html body', () => {
    const summary = emptySummary({
      robotsContentChanged: true,
      robotsDiff: { added: ['<script>alert(1)</script>'], removed: [], truncated: false },
    })
    const { html, text } = buildRobotsChangeEmail({ ...base, summary })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(text).toContain('<script>alert(1)</script>') // text body is plain
  })

  it('transport-honest unreachable wording (Codex #7): observation, not a site claim', () => {
    const summary = emptySummary({ robotsStatus: { prev: 'ok', curr: 'unreachable' } })
    const { text } = buildRobotsChangeEmail({ ...base, summary, currFailure: 'timeout' })
    expect(text).toContain('could not be fetched (timeout)')
    expect(text.toLowerCase()).not.toContain('removed')
  })

  it('reorder-only change (non-null EMPTY diff) gets the formatting-only notice', () => {
    const summary = emptySummary({
      robotsContentChanged: true,
      robotsDiff: { added: [], removed: [], truncated: false },
    })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('reordering or formatting only')
  })

  it('null diff with changed content -> "line diff unavailable", never formatting-only (plan-Codex #3)', () => {
    const summary = emptySummary({ robotsContentChanged: true, robotsDiff: null })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('line diff unavailable')
    expect(text).not.toContain('formatting only')
  })

  it('link present only when appUrl is set', () => {
    const summary = emptySummary({ robotsContentChanged: true })
    expect(buildRobotsChangeEmail({ ...base, summary }).html).toContain('https://seo.example.com/clients/7')
    expect(buildRobotsChangeEmail({ ...base, summary, appUrl: null }).html).not.toContain('/clients/7')
  })

  it('renders sitemap deltas and count movement', () => {
    const summary = emptySummary({
      sitemaps: { added: ['https://acme.edu/new.xml'], removed: [], changed: [{ url: 'https://acme.edu/s.xml', urlCountPrev: 100, urlCountCurr: 60, childrenChanged: false }], orderChanged: false },
      sitemapUrlTotal: { prev: 100, curr: 60 },
      counts: { errorsPrev: 0, errorsCurr: 2, warningsPrev: 1, warningsCurr: 1 },
    })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('https://acme.edu/new.xml')
    expect(text).toContain('100')
    expect(text).toContain('60')
    expect(text).toContain('errors 0')
  })
})
