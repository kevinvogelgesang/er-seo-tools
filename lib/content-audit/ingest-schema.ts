// lib/content-audit/ingest-schema.ts
// Pure strict validator for cat_ PATCH-ingested content-audit findings.
// Enforces type/severity enums, per-field caps, an aggregate serialized-byte
// cap, and evidence-URL membership in the audit's eligible page set. Reject,
// never truncate.
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'

export const CONTENT_AUDIT_FINDING_TYPES = ['data_inconsistency', 'stale_claim', 'quality_issue'] as const
export const CONTENT_AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type ContentAuditFindingType = (typeof CONTENT_AUDIT_FINDING_TYPES)[number]
export type ContentAuditSeverity = (typeof CONTENT_AUDIT_SEVERITIES)[number]

const MAX_FINDINGS = 200
const MAX_EVIDENCE = 20
const MAX_STRING = 2000
const MAX_TOTAL_BYTES = 262144 // 256 KB

export interface ContentAuditEvidence { url: string; snippet: string }
export interface ContentAuditFinding {
  type: ContentAuditFindingType
  severity: ContentAuditSeverity
  title: string
  detail: string
  evidence: ContentAuditEvidence[]
  recommendation: string
}
export interface ContentAuditPayload { v: 1; generatedAt: string; findings: ContentAuditFinding[] }

type Result = { ok: true; payload: ContentAuditPayload } | { ok: false; code: string }

const isStr = (v: unknown, max = MAX_STRING): v is string =>
  typeof v === 'string' && v.length <= max

export function validateContentAuditFindings(input: unknown, allowedUrls: Set<string>, now: Date): Result {
  const root = input as { findings?: unknown }
  if (!root || typeof root !== 'object' || !Array.isArray(root.findings)) {
    return { ok: false, code: 'invalid_findings' }
  }
  if (root.findings.length > MAX_FINDINGS) return { ok: false, code: 'invalid_findings' }

  const out: ContentAuditFinding[] = []
  for (const raw of root.findings) {
    const f = raw as Partial<ContentAuditFinding>
    if (!f || typeof f !== 'object') return { ok: false, code: 'invalid_findings' }
    if (!CONTENT_AUDIT_FINDING_TYPES.includes(f.type as ContentAuditFindingType)) return { ok: false, code: 'invalid_findings' }
    if (!CONTENT_AUDIT_SEVERITIES.includes(f.severity as ContentAuditSeverity)) return { ok: false, code: 'invalid_findings' }
    if (!isStr(f.title) || !isStr(f.detail) || !isStr(f.recommendation)) return { ok: false, code: 'invalid_findings' }
    if (!Array.isArray(f.evidence) || f.evidence.length > MAX_EVIDENCE) return { ok: false, code: 'invalid_findings' }

    const evidence: ContentAuditEvidence[] = []
    for (const e of f.evidence) {
      const ev = e as Partial<ContentAuditEvidence>
      if (!ev || typeof ev !== 'object' || !isStr(ev.url, 2048) || !isStr(ev.snippet)) return { ok: false, code: 'invalid_findings' }
      let norm: string
      try { norm = normalizeFindingUrl(ev.url) } catch { return { ok: false, code: 'evidence_url_not_in_audit' } }
      if (!allowedUrls.has(norm)) return { ok: false, code: 'evidence_url_not_in_audit' }
      evidence.push({ url: norm, snippet: ev.snippet })
    }
    out.push({
      type: f.type as ContentAuditFindingType,
      severity: f.severity as ContentAuditSeverity,
      title: f.title, detail: f.detail, recommendation: f.recommendation, evidence,
    })
  }

  const payload: ContentAuditPayload = { v: 1, generatedAt: now.toISOString(), findings: out }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_TOTAL_BYTES) {
    return { ok: false, code: 'findings_too_large' }
  }
  return { ok: true, payload }
}
