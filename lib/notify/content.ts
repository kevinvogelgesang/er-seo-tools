// lib/notify/content.ts
// Pure email content builders. No transport, no env. Every dynamic string is
// HTML-escaped for the html body; the text body is plain.

export interface EmailContent { subject: string; html: string; text: string }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtScore(n: number | null): string {
  return n == null ? '—' : String(n)
}

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export interface CompleteInput {
  domain: string
  scanType: string
  requestedBy: string | null
  adaScore: number | null
  seoScore: number | null
  durationMs: number | null
  resultsUrl: string
  seoUnavailable?: boolean
}

export function buildCompleteEmail(input: CompleteInput): EmailContent {
  const seoPart = input.seoUnavailable ? 'SEO n/a' : `SEO ${fmtScore(input.seoScore)}`
  const subject = `Site audit finished — ${input.domain} (ADA ${fmtScore(input.adaScore)} · ${seoPart})`
  const greeting = input.requestedBy ? `Hi ${input.requestedBy},` : 'Hi,'
  const seoLine = input.seoUnavailable
    ? 'SEO analysis unavailable for this run.'
    : `SEO score: ${fmtScore(input.seoScore)}`
  const lines = [
    greeting,
    ``,
    `Your ${input.scanType} site audit for ${input.domain} has finished.`,
    ``,
    `ADA score: ${fmtScore(input.adaScore)}`,
    seoLine,
    `Duration: ${fmtDuration(input.durationMs)}`,
    ``,
    `View the results: ${input.resultsUrl}`,
  ]
  const text = lines.join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;">
    <p>${esc(greeting)}</p>
    <p>Your ${esc(input.scanType)} site audit for <strong>${esc(input.domain)}</strong> has finished.</p>
    <ul>
      <li>ADA score: ${fmtScore(input.adaScore)}</li>
      <li>${esc(seoLine)}</li>
      <li>Duration: ${esc(fmtDuration(input.durationMs))}</li>
    </ul>
    <p><a href="${esc(input.resultsUrl)}">View the results</a></p>
  </div>`
  return { subject, html, text }
}

export interface FailedInput {
  domain: string
  requestedBy: string | null
  error: string
  resultsUrl: string
}

export function buildFailedEmail(input: FailedInput): EmailContent {
  const subject = `Site audit FAILED — ${input.domain}`
  const lines = [
    `A site audit failed.`,
    ``,
    `Domain: ${input.domain}`,
    `Requested by: ${input.requestedBy ?? 'unknown'}`,
    `Error: ${input.error}`,
    ``,
    `Audit: ${input.resultsUrl}`,
  ]
  const text = lines.join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;">
    <p>A site audit failed.</p>
    <ul>
      <li>Domain: <strong>${esc(input.domain)}</strong></li>
      <li>Requested by: ${esc(input.requestedBy ?? 'unknown')}</li>
      <li>Error: ${esc(input.error)}</li>
    </ul>
    <p><a href="${esc(input.resultsUrl)}">Open the audit</a></p>
  </div>`
  return { subject, html, text }
}
