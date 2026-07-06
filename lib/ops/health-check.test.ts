// lib/ops/health-check.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth, normalizeAppUrl, type HealthSignals } from './health-check'
import type { AlertState } from './alert-state'

const now = new Date('2026-07-02T12:00:00Z')
const OPTS = {
  lookbackMs: 15 * 60_000, cooldownMs: 360 * 60_000, backupStaleHours: 26,
  appUrl: 'https://seo.example.com',
}
const clean: HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [],
  stalledAudit: null, newestBackupAgeHours: 1,
}
const st: AlertState = { lastCheckAt: now.getTime() - OPTS.lookbackMs, cooldowns: {} }

describe('evaluateHealth', () => {
  it('all clean → no alerts, advances lastCheckAt', () => {
    const r = evaluateHealth(clean, st, now, OPTS)
    expect(r.alerts).toEqual([])
    expect(r.nextState.lastCheckAt).toBe(now.getTime())
  })

  it('site-audit detail line has domain, error in code span, and a View scan link', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 'sa1', domain: 'acme.edu', error: 'Navigation timeout of 30000 ms exceeded' }],
    }, st, now, OPTS)
    expect(r.alerts).toEqual([
      '• Site audit *acme.edu* errored: `Navigation timeout of 30000 ms exceeded` — <https://seo.example.com/ada-audit/site/sa1|View scan>',
    ])
  })

  it('count > 0 with EMPTY detail array still alerts (aggregate fallback)', () => {
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 2 }, st, now, OPTS)
    expect(r.alerts).toEqual(['• 2 site audit(s) errored since last check'])
  })

  it('overflow appends "…and N more" from count - details.length', () => {
    const details = Array.from({ length: 5 }, (_, i) => ({ id: `sa${i}`, domain: `d${i}.edu`, error: 'x' }))
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 7, erroredSiteAuditDetails: details }, st, now, OPTS)
    expect(r.alerts).toHaveLength(6)
    expect(r.alerts[5]).toBe('  …and 2 more errored site audit(s)')
  })

  it('ADA child links to parent site audit; standalone links to its own page', () => {
    const r = evaluateHealth({
      ...clean, newErroredAdaAudits: 2,
      erroredAdaAuditDetails: [
        { id: 'a1', url: 'https://acme.edu/apply', error: 'boom', siteAuditId: 'sa9' },
        { id: 'a2', url: 'https://foo.edu/', error: 'boom', siteAuditId: null },
      ],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/site/sa9|View scan>')
    expect(r.alerts[1]).toContain('<https://seo.example.com/ada-audit/a2|View scan>')
  })

  it('exhausted job links via groupKey when it names a scan; others unlinked', () => {
    const r = evaluateHealth({
      ...clean, newExhaustedJobs: 4,
      exhaustedJobDetails: [
        { id: 'j1', type: 'site-audit-page', lastError: 'timeout', groupKey: 'site-audit:sa5' },
        { id: 'j2', type: 'ada-audit', lastError: 'timeout', groupKey: 'ada-audit:a7' },
        { id: 'j3', type: 'cleanup', lastError: 'disk full', groupKey: null },
        { id: 'j4', type: 'weird`type <x>', lastError: 'x', groupKey: ':' },
      ],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('Job `site-audit-page` exhausted retries: `timeout`')
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/site/sa5|View scan>')
    expect(r.alerts[1]).toContain('<https://seo.example.com/ada-audit/a7|View scan>')
    expect(r.alerts[2]).toBe('• Job `cleanup` exhausted retries: `disk full`')
    // Job type is DB string data: backticks neutralized + mrkdwn-escaped, and a
    // malformed groupKey (':' — empty prefix/id) never yields a link.
    expect(r.alerts[3]).toBe("• Job `weird'type &lt;x&gt;` exhausted retries: `x`")
  })

  it('error text: collapse newlines → truncate 140 → backticks neutralized → mrkdwn escaped', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's', domain: 'a.edu', error: 'Bad <tag> & `code`\nline2' }],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain("`Bad &lt;tag&gt; &amp; 'code' line2`")

    const long = 'e'.repeat(150)
    const r2 = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's', domain: 'a.edu', error: long }],
    }, st, now, OPTS)
    expect(r2.alerts[0]).toContain('`' + 'e'.repeat(139) + '…`')
  })

  it('null error renders placeholder; long display labels truncate at 60', () => {
    const longUrl = 'https://acme.edu/' + 'p'.repeat(80)
    const r = evaluateHealth({
      ...clean, newErroredAdaAudits: 1,
      erroredAdaAuditDetails: [{ id: 'a1', url: longUrl, error: null, siteAuditId: null }],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('`(no error message)`')
    expect(r.alerts[0]).toContain(`*${longUrl.slice(0, 59)}…*`)
    // Link TARGET is never truncated.
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/a1|View scan>')
  })

  it('appUrl null → no link syntax anywhere', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's1', domain: 'a.edu', error: 'x' }],
      stalledAudit: { id: 'sa2', minutesStuck: 74 },
    }, st, now, { ...OPTS, appUrl: null })
    for (const line of r.alerts) expect(line).not.toContain('|View scan>')
  })

  it('queue-stalled fires once with a link then is suppressed by cooldown', () => {
    const sig = { ...clean, stalledAudit: { id: 'a1', minutesStuck: 74 } }
    const r1 = evaluateHealth(sig, st, now, OPTS)
    const stallLine = r1.alerts.find((a) => /stall/i.test(a))
    expect(stallLine).toContain('<https://seo.example.com/ada-audit/site/a1|View scan>')
    const r2 = evaluateHealth(sig, r1.nextState, new Date(now.getTime() + 60_000), OPTS)
    expect(r2.alerts.some((a) => /stall/i.test(a))).toBe(false)
  })

  it('backup-stale fires when age exceeds threshold or no backup exists', () => {
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: 31 }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: null }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
  })
})

describe('normalizeAppUrl', () => {
  it('accepts absolute http(s), strips trailing slash', () => {
    expect(normalizeAppUrl('https://seo.example.com/')).toBe('https://seo.example.com')
    expect(normalizeAppUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('rejects unset, relative, and non-http values', () => {
    expect(normalizeAppUrl(undefined)).toBeNull()
    expect(normalizeAppUrl('')).toBeNull()
    expect(normalizeAppUrl('seo.example.com')).toBeNull()
    expect(normalizeAppUrl('ftp://x')).toBeNull()
  })
})
