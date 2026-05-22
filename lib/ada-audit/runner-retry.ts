// Narrow predicate for runner errors that empirical evidence (the 2026-05-21
// queue-wide run + manual re-scan testing) suggests recover on a single
// fresh-page retry. We deliberately do NOT match HTTP status errors (4xx/5xx
// are deterministic at the source) or SSRF blocks (correct refusal).

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /Navigation timeout of \d+ ms exceeded/i,
  /Navigating frame was detached/i,
  /net::ERR_CERT_VERIFIER_CHANGED/i,
]

export function isTransientRunnerError(err: unknown): boolean {
  let msg: string
  if (err instanceof Error) msg = err.message
  else if (typeof err === 'string') msg = err
  else return false

  return TRANSIENT_PATTERNS.some((re) => re.test(msg))
}
