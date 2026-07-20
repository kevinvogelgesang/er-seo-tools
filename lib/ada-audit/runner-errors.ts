// lib/ada-audit/runner-errors.ts
// Structured classifier for runAxeAudit throws. This is the single home of the
// domain-vs-infrastructure split (architecture-contract §"Domain vs
// infrastructure errors"). Pure Node — no injection, no side effects.
//
// Consumers:
//   - site-audit-page.ts: rethrows ONLY `infrastructure` so the durable queue
//     retries the whole page job on a fresh worker tick; captures 404/410 as a
//     dead_page finding.
//   - runner.ts: `acquirePageWithRetry` retries ONLY `infrastructure`.
//
// `infrastructure` is DELIBERATELY NARROW — Chrome/pool/protocol only. It is
// DISTINCT from runner-retry.ts's broader in-navigation `isTransientRunnerError`
// (navigation timeout, frame-detach, cert changes) which stays local to
// attemptNavigation. Do NOT unify the two lists: a navigation timeout is
// `timeout` here, never `infrastructure`.
import { SafeUrlError } from '@/lib/security/safe-url'

export type RunnerErrorKind =
  | 'infrastructure' // Chrome/pool/protocol ONLY — durable-queue-retryable
  | 'http-status' // non-2xx the runner rejected; carries `status`
  | 'non-html' // 2xx but not HTML (e.g. rss+xml) — correct, not dead
  | 'ssrf' // SafeUrlError.reason === 'policy' — never retry, never a finding
  | 'timeout' // navigation timeout — handled by the in-nav retry, not queue-propagated
  | 'other'

export interface ClassifiedRunnerError {
  kind: RunnerErrorKind
  status?: number
}

// NARROW: only Chrome/pool/protocol failures warrant durable-queue retry.
// Do NOT add navigation-timeout here (that is the in-nav retry's job).
const INFRA_RE = /Target\.createTarget|Target closed|Session closed|Connection closed|Protocol error \(Target\./i
const TIMEOUT_RE = /Navigation timeout of \d+ ms exceeded/i
const NON_HTML_RE = /Response is not HTML/i
const HTTP_RE = /^HTTP (\d{3})\b/

export function classifyRunnerError(err: unknown): ClassifiedRunnerError {
  if (err instanceof SafeUrlError) {
    return { kind: err.reason === 'policy' ? 'ssrf' : 'other' }
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const http = HTTP_RE.exec(msg)
  if (http) return { kind: 'http-status', status: Number(http[1]) }
  if (INFRA_RE.test(msg)) return { kind: 'infrastructure' }
  if (TIMEOUT_RE.test(msg)) return { kind: 'timeout' }
  if (NON_HTML_RE.test(msg)) return { kind: 'non-html' }
  return { kind: 'other' }
}
