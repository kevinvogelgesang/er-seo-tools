// lib/notify/sweep-digest-content.test.ts
import { describe, it, expect } from 'vitest'
import { buildSweepDigestEmail, DIGEST_EFFORT_NUDGE } from './sweep-digest-content'
import type { SweepSnapshot, IssueGroup } from '@/lib/sweep/types'

function group(overrides: Partial<IssueGroup> = {}): IssueGroup {
  return {
    clientId: 1,
    clientName: 'Acme University',
    domain: 'acme.edu',
    tool: 'seo-parser',
    type: 'broken_internal_links',
    severity: 'critical',
    unit: 'targets',
    affectedCount: 5,
    approximate: false,
    title: 'Broken internal links',
    changeState: 'worsened',
    delta: 2,
    streak: 1,
    severityChanged: null,
    coverageState: 'comparable',
    lastObservedAt: '2026-07-13T00:00:00.000Z',
    siteAuditId: 'sa_123',
    liveScanRunId: null,
    ...overrides,
  }
}

function baseTotals(): SweepSnapshot['totals'] {
  return {
    actionable: 12,
    delta: -3,
    comparablePairs: 24,
    newCount: 2,
    worsenedCount: 3,
    resolvedCount: 5,
    scanned: 27,
    expected: 30,
    comparableDomains: 24,
    partialDomains: 1,
    failedDomains: 2,
  }
}

function snapshot(overrides: Partial<SweepSnapshot> = {}): SweepSnapshot {
  return {
    v: 1,
    snapshotAt: '2026-07-13T09:00:00.000Z',
    totals: baseTotals(),
    coverage: [],
    groups: [],
    staleGroups: [],
    resolvedGroups: [],
    shortlist: [group()],
    semanticKeys: [],
    ...overrides,
  }
}

describe('buildSweepDigestEmail', () => {
  it('pins the exact subject line for a fewer-issues week', () => {
    const { subject } = buildSweepDigestEmail(snapshot(), 'https://app.example.com')
    expect(subject).toBe('Weekly scan digest — 12 actionable issues (▼3)')
  })

  it('pins the exact subject line for a worse week', () => {
    const s = snapshot({ totals: { ...baseTotals(), delta: 4 } })
    const { subject } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(subject).toBe('Weekly scan digest — 12 actionable issues (▲4)')
  })

  it('pins the exact subject line for a first-baseline week', () => {
    const s = snapshot({ totals: { ...baseTotals(), delta: null } })
    const { subject } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(subject).toBe('Weekly scan digest — 12 actionable issues (first baseline)')
  })

  it('pins the exact subject line for a flat week (delta exactly 0 renders neutrally, never ▲0)', () => {
    const s = snapshot({ totals: { ...baseTotals(), delta: 0 } })
    const { subject } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(subject).toBe('Weekly scan digest — 12 actionable issues (no change)')
  })

  it('surfaces the new/worsened/resolved breakout from precomputed totals (net delta can mask churn)', () => {
    const { text, html } = buildSweepDigestEmail(snapshot(), 'https://app.example.com')
    expect(text).toContain('2 new · 3 worsened · 5 no longer detected')
    expect(html).toContain('2 new · 3 worsened · 5 no longer detected')
  })

  it('HTML-escapes a client name containing an ampersand', () => {
    const s = snapshot({ shortlist: [group({ clientName: 'A&B College' })] })
    const { html } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(html).toContain('A&amp;B College')
    expect(html).not.toContain('>A&B College<')
  })

  it('renders "first baseline — no comparison" when totals.delta is null', () => {
    const s = snapshot({ totals: { ...baseTotals(), delta: null } })
    const { text, html } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(text).toContain('first baseline — no comparison')
    expect(html).toContain('first baseline — no comparison')
  })

  it('renders "No new or worsened issues this week" when the shortlist is empty', () => {
    const s = snapshot({ shortlist: [] })
    const { text, html } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(text).toContain('No new or worsened issues this week')
    expect(html).toContain('No new or worsened issues this week')
  })

  it('omits all links (zero anchor tags) when appUrl is null', () => {
    const s = snapshot({ shortlist: [group({ siteAuditId: 'sa_999' })] })
    const { html } = buildSweepDigestEmail(s, null)
    expect(html).not.toContain('<a ')
  })

  it('renders per-item audit links and the /issues deep link when appUrl is non-null', () => {
    const { html } = buildSweepDigestEmail(snapshot(), 'https://app.example.com/')
    expect(html).toContain('https://app.example.com/ada-audit/site/sa_123')
    expect(html).toContain('https://app.example.com/issues')
  })

  it('includes the effort nudge only when there is a shortlist', () => {
    const withItems = buildSweepDigestEmail(snapshot(), 'https://app.example.com')
    expect(withItems.text).toContain(DIGEST_EFFORT_NUDGE)
    const empty = buildSweepDigestEmail(snapshot({ shortlist: [] }), 'https://app.example.com')
    expect(empty.text).not.toContain(DIGEST_EFFORT_NUDGE)
  })

  it('reports the coverage line with the spec-exact separators', () => {
    const { text } = buildSweepDigestEmail(snapshot(), 'https://app.example.com')
    expect(text).toContain('27/30 scanned · 24 comparable · 1 partial · 2 failed')
  })

  it('never claims a resolved issue is "fixed" — only "no longer detected"', () => {
    const s = snapshot({
      resolvedGroups: [
        {
          clientId: 1,
          clientName: 'Acme University',
          domain: 'acme.edu',
          tool: 'seo-parser',
          type: 'missing_title',
          title: 'Missing title tag',
          severity: 'warning',
          priorCount: 3,
          unit: 'pages',
          siteAuditId: null,
          liveScanRunId: null,
        },
      ],
    })
    const { text } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(text).toContain('no longer detected')
    expect(text.toLowerCase()).not.toContain('fixed')
  })

  it('uses the canonical notice-filtered totals.resolvedCount, never raw resolvedGroups.length', () => {
    // Two resolved groups, one of them notice-severity. The canonical
    // totals.resolvedCount (lib/sweep/snapshot.ts computeTotals) is
    // notice-filtered, so the digest must say 1, not 2.
    const resolved = {
      clientId: 1,
      clientName: 'Acme University',
      domain: 'acme.edu',
      tool: 'seo-parser' as const,
      type: 'missing_title',
      title: 'Missing title tag',
      severity: 'warning' as const,
      priorCount: 3,
      unit: 'pages' as const,
      siteAuditId: null,
      liveScanRunId: null,
    }
    const s = snapshot({
      totals: { ...baseTotals(), resolvedCount: 1 },
      resolvedGroups: [resolved, { ...resolved, type: 'notice_thing', severity: 'notice' as const }],
    })
    const { text } = buildSweepDigestEmail(s, 'https://app.example.com')
    expect(text).toContain('1 issue no longer detected')
    expect(text).not.toContain('2 issues no longer detected')
  })

  it('gives shortlist items factual ranking lines (severity · changeState · count+unit)', () => {
    const { text } = buildSweepDigestEmail(snapshot(), 'https://app.example.com')
    expect(text).toContain('Critical · worsened · 5 targets')
  })
})
