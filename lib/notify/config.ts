// lib/notify/config.ts
// Single home for all D7 notify env reads. Dark-by-default gate lives here.
// US region default; MAILGUN_API_BASE overrides for an EU account.

export function isNotifyEnabled(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)
}

export function mailgunConfig(): { apiKey: string; domain: string; baseUrl: string } | null {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN
  if (!apiKey || !domain) return null
  const baseUrl = (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').replace(/\/+$/, '')
  return { apiKey, domain, baseUrl }
}

export function notifyFrom(): string {
  return process.env.NOTIFY_FROM || 'kevin@enrollmentresources.com'
}

export function notifyReplyTo(): string {
  return process.env.NOTIFY_REPLY_TO || 'kevin@enrollmentresources.com'
}

export function notifyAdminEmail(): string {
  return process.env.NOTIFY_ADMIN_EMAIL || notifyFrom()
}

export function notifyRequestTimeoutMs(): number {
  return Number(process.env.NOTIFY_REQUEST_TIMEOUT_MS) || 10_000
}

export function supportNotifyEmail(): string {
  return process.env.SUPPORT_NOTIFY_EMAIL || 'support@enrollmentresources.com'
}
