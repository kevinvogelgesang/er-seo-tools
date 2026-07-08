// lib/notify/content.ts
// Pure email content builders. No transport, no env. Every dynamic string is
// HTML-escaped for the html body; the text body is plain. Branded, table-based
// HTML (Gmail/Outlook safe); enrichment sections render only when non-null.

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

const COLOR = { green: '#16a34a', amber: '#d97706', red: '#dc2626', muted: '#9ca3af',
  navy: '#1c2d4a', pageBg: '#f4f5f7', hair: '#e5e7eb', ink: '#111827', sub: '#6b7280' }

function scoreColor(n: number | null): string {
  if (n == null) return COLOR.muted
  if (n >= 90) return COLOR.green
  if (n >= 70) return COLOR.amber
  return COLOR.red
}

function fmtDelta(n: number | null | undefined): string | null {
  if (n == null) return null
  if (n === 0) return '±0'
  return n > 0 ? `▲+${n}` : `▼${n}`
}

function fmtPages(complete?: number | null, total?: number | null): string | null {
  if (complete == null) return null
  return total != null && total > 0 ? `${complete} of ${total}` : String(complete)
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
  pagesComplete?: number | null
  pagesTotal?: number | null
  counts?: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null } | null
  partial?: { seo?: boolean; ada?: boolean } | null
  change?: { seoDelta?: number | null; adaDelta?: number | null; newIssues?: number | null; resolvedIssues?: number | null; previousDate?: string | null } | null
}

function scoreCardHtml(label: string, value: string, color: string): string {
  return `<td align="center" style="padding:12px 8px;border:1px solid ${COLOR.hair};border-radius:8px;">
    <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:${COLOR.sub};">${esc(label)}</div>
    <div style="font-size:28px;font-weight:700;color:${color};line-height:1.2;">${esc(value)}</div></td>`
}

function buttonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="border-radius:6px;background:${COLOR.navy};">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 26px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td></tr></table>`
}

function shellHtml(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${COLOR.hair};border-radius:10px;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;color:${COLOR.ink};">
        <tr><td style="background:${COLOR.navy};padding:16px 24px;font-size:16px;font-weight:700;color:#ffffff;">ER SEO Tools</td></tr>
        <tr><td style="padding:24px;">${inner}</td></tr>
      </table>
    </td></tr></table>`
}

export function buildCompleteEmail(input: CompleteInput): EmailContent {
  const seoPart = input.seoUnavailable ? 'SEO n/a' : `SEO ${fmtScore(input.seoScore)}`
  const subject = `Site audit finished — ${input.domain} (ADA ${fmtScore(input.adaScore)} · ${seoPart})`
  const greeting = input.requestedBy ? `Hi ${input.requestedBy},` : 'Hi,'
  const pages = fmtPages(input.pagesComplete, input.pagesTotal)

  // --- score cards ---
  const cards: string[] = [
    scoreCardHtml('ADA', fmtScore(input.adaScore), scoreColor(input.adaScore)),
    scoreCardHtml('SEO', input.seoUnavailable ? '—' : fmtScore(input.seoScore), input.seoUnavailable ? COLOR.muted : scoreColor(input.seoScore)),
  ]
  if (pages) cards.push(scoreCardHtml('Pages', pages, COLOR.ink))
  const cardsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>${cards.join('')}</tr></table>`

  // --- change strip ---
  const ch = input.change
  const changeBits: string[] = []
  if (ch) {
    const sd = fmtDelta(ch.seoDelta); if (sd && ch.seoDelta != null) changeBits.push(`SEO ${sd}`)
    const ad = fmtDelta(ch.adaDelta); if (ad && ch.adaDelta != null) changeBits.push(`ADA ${ad}`)
    if (ch.newIssues != null) changeBits.push(`${ch.newIssues} new`)
    if (ch.resolvedIssues != null) changeBits.push(`${ch.resolvedIssues} resolved`)
  }
  const changeHtml = changeBits.length
    ? `<p style="margin:16px 0 0;font-size:13px;color:${COLOR.sub};">Since last scan${ch?.previousDate ? ` (${esc(ch.previousDate)})` : ''}: ${esc(changeBits.join(' · '))}</p>`
    : ''

  // --- counts table ---
  const cn = input.counts
  const partialTag = (on?: boolean) => (on ? ` <span style="color:${COLOR.amber};">(incomplete scan)</span>` : '')
  const countRow = (label: string, val: number | null, incomplete?: boolean) =>
    val == null ? '' : `<tr><td style="padding:6px 0;font-size:14px;">${esc(label)}${partialTag(incomplete)}</td>
      <td align="right" style="padding:6px 0;font-size:14px;font-weight:600;">${val}</td></tr>`
  const countRows = cn ? [
    countRow('Broken links & images', cn.brokenLinks, input.partial?.seo),
    countRow('On-page issues', cn.onPageIssues, input.partial?.seo),
    countRow('ADA violations', cn.adaViolations, input.partial?.ada),
  ].join('') : ''
  const countsHtml = countRows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid ${COLOR.hair};">${countRows}</table>`
    : ''

  const inner = `<p style="margin:0 0 4px;font-size:14px;">${esc(greeting)}</p>
    <p style="margin:0 0 16px;font-size:14px;">Your ${esc(input.scanType)} site audit for <strong>${esc(input.domain)}</strong> has finished${input.durationMs ? ` in ${esc(fmtDuration(input.durationMs))}` : ''}.</p>
    ${cardsHtml}${changeHtml}${countsHtml}
    <div style="margin-top:24px;">${buttonHtml(input.resultsUrl, 'View full report')}</div>`

  // --- text body (lockstep) ---
  const seoLine = input.seoUnavailable ? 'SEO analysis unavailable for this run.' : `SEO score: ${fmtScore(input.seoScore)}`
  const tLines = [greeting, '', `Your ${input.scanType} site audit for ${input.domain} has finished.`, '',
    `ADA score: ${fmtScore(input.adaScore)}`, seoLine]
  if (pages) tLines.push(`Pages scanned: ${pages}`)
  tLines.push(`Duration: ${fmtDuration(input.durationMs)}`)
  if (changeBits.length) tLines.push('', `Since last scan${ch?.previousDate ? ` (${ch.previousDate})` : ''}: ${changeBits.join(' · ')}`)
  if (cn) {
    const tCount = (label: string, val: number | null, inc?: boolean) => val == null ? null : `${label}: ${val}${inc ? ' (incomplete scan)' : ''}`
    const rows = [tCount('Broken links & images', cn.brokenLinks, input.partial?.seo),
      tCount('On-page issues', cn.onPageIssues, input.partial?.seo),
      tCount('ADA violations', cn.adaViolations, input.partial?.ada)].filter(Boolean)
    if (rows.length) tLines.push('', ...rows as string[])
  }
  tLines.push('', `View the results: ${input.resultsUrl}`)

  return { subject, html: shellHtml(inner), text: tLines.join('\n') }
}

export interface FailedInput {
  domain: string
  requestedBy: string | null
  error: string
  resultsUrl: string
}

const MAX_ERROR_LEN = 500

export function buildFailedEmail(input: FailedInput): EmailContent {
  const err = input.error.length > MAX_ERROR_LEN ? input.error.slice(0, MAX_ERROR_LEN) + '…' : input.error
  const subject = `Site audit FAILED — ${input.domain}`
  const inner = `<p style="margin:0 0 12px;font-size:14px;">A site audit <strong style="color:${COLOR.red};">failed</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      <tr><td style="padding:4px 0;color:${COLOR.sub};">Domain</td><td align="right"><strong>${esc(input.domain)}</strong></td></tr>
      <tr><td style="padding:4px 0;color:${COLOR.sub};">Requested by</td><td align="right">${esc(input.requestedBy ?? 'unknown')}</td></tr>
    </table>
    <pre style="margin:12px 0;padding:10px;background:${COLOR.pageBg};border:1px solid ${COLOR.hair};border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(err)}</pre>
    <div style="margin-top:16px;">${buttonHtml(input.resultsUrl, 'Open the audit')}</div>`
  const text = [`A site audit failed.`, '', `Domain: ${input.domain}`,
    `Requested by: ${input.requestedBy ?? 'unknown'}`, `Error: ${err}`, '', `Audit: ${input.resultsUrl}`].join('\n')
  return { subject, html: shellHtml(inner), text }
}
