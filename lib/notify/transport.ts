// lib/notify/transport.ts
// Mailgun Messages API over plain fetch — no SDK, no SMTP. Injectable deps so
// all callers/tests run mocked. NEVER logs MAILGUN_API_KEY; error bodies are
// truncated before being surfaced.

import { mailgunConfig, notifyFrom, notifyReplyTo, notifyRequestTimeoutMs } from './config'
import type { EmailContent } from './content'

export interface NotifyDeps {
  fetch: typeof fetch
  now: () => number
}

export const realNotifyDeps: NotifyDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
}

export interface SendArgs {
  to: string
  content: EmailContent
}

export async function sendEmail(args: SendArgs, deps: NotifyDeps = realNotifyDeps): Promise<void> {
  const cfg = mailgunConfig()
  if (!cfg) throw new Error('notify transport not configured (Mailgun env unset)')

  const body = new URLSearchParams()
  body.set('from', notifyFrom())
  body.set('h:Reply-To', notifyReplyTo())
  body.set('to', args.to)
  body.set('subject', args.content.subject)
  body.set('text', args.content.text)
  body.set('html', args.content.html)

  const res = await deps.fetch(`${cfg.baseUrl}/v3/${cfg.domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(notifyRequestTimeoutMs()),
  })

  if (res.status < 200 || res.status >= 300) {
    let snippet = ''
    try { snippet = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    // Redact the key defensively in case Mailgun echoes it.
    if (cfg.apiKey) snippet = snippet.split(cfg.apiKey).join('<redacted>')
    throw new Error(`Mailgun send failed: ${res.status} ${snippet}`)
  }
}
