// lib/ops/alert-webhook.ts
//
// D0 ops safety — failure-alert delivery. ALERT_WEBHOOK_URL is trusted
// operator config (not user input), so a plain timed fetch is correct — NOT
// safeFetch, which would block a legitimately-internal endpoint. Never throws:
// a monitoring job must not itself become a failed job. The {sent, skipped}
// split lets the caller distinguish "deliberately dark" (URL unset) from a
// genuine delivery failure, so it never advances dedup state on the latter.
export async function sendAlert(text: string): Promise<{ sent: boolean; skipped: boolean }> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) {
    console.log(`[health-alert] webhook unset; alert not sent: ${text}`)
    return { sent: false, skipped: true }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    })
    if (res.ok) return { sent: true, skipped: false }
    console.warn(`[health-alert] webhook responded ${res.status}`)
    return { sent: false, skipped: false }
  } catch (err) {
    console.warn(`[health-alert] webhook post failed: ${(err as Error).message}`)
    return { sent: false, skipped: false }
  } finally {
    clearTimeout(timer)
  }
}
