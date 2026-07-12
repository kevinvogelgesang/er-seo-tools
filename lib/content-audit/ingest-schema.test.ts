import { describe, it, expect } from 'vitest'
import { validateContentAuditFindings } from './ingest-schema'

const NOW = new Date('2026-07-13T00:00:00Z')
const allowed = new Set(['https://ex.com/a', 'https://ex.com/b'])
const good = {
  findings: [{
    type: 'data_inconsistency', severity: 'warning',
    title: 'Tuition differs', detail: 'A says $14,500; B says $15,200',
    evidence: [{ url: 'https://ex.com/a', snippet: '$14,500' }, { url: 'https://ex.com/b', snippet: '$15,200' }],
    recommendation: 'Reconcile to one figure',
  }],
}

describe('validateContentAuditFindings', () => {
  it('accepts a well-formed payload and stamps v + server generatedAt', () => {
    const r = validateContentAuditFindings(good, allowed, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.v).toBe(1)
      expect(r.payload.generatedAt).toBe(NOW.toISOString())
      expect(r.payload.findings[0].type).toBe('data_inconsistency')
    }
  })
  it('rejects an unknown type', () => {
    const r = validateContentAuditFindings({ findings: [{ ...good.findings[0], type: 'made_up' }] }, allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects an unknown severity', () => {
    const r = validateContentAuditFindings({ findings: [{ ...good.findings[0], severity: 'urgent' }] }, allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects an evidence url not in the audit page set', () => {
    const r = validateContentAuditFindings(
      { findings: [{ ...good.findings[0], evidence: [{ url: 'https://evil.com/x', snippet: 'y' }] }] },
      allowed, NOW)
    expect(r).toEqual({ ok: false, code: 'evidence_url_not_in_audit' })
  })
  it('rejects more than MAX_FINDINGS', () => {
    const many = { findings: Array.from({ length: 201 }, () => good.findings[0]) }
    expect(validateContentAuditFindings(many, allowed, NOW)).toEqual({ ok: false, code: 'invalid_findings' })
  })
  it('rejects a payload over the aggregate byte cap', () => {
    const big = { findings: [{ ...good.findings[0], detail: 'x'.repeat(1999) }] }
    // 200 findings * ~2k each would exceed 256k; force it via many findings each near cap
    const huge = { findings: Array.from({ length: 200 }, () => big.findings[0]) }
    expect(validateContentAuditFindings(huge, allowed, NOW)).toEqual({ ok: false, code: 'findings_too_large' })
  })
  it('normalizes evidence urls before the allowlist check', () => {
    const r = validateContentAuditFindings(
      { findings: [{ ...good.findings[0], evidence: [{ url: 'https://ex.com/a#frag', snippet: 'z' }] }] },
      allowed, NOW)
    expect(r.ok).toBe(true) // normalizeFindingUrl strips the fragment to match /a
  })
})
