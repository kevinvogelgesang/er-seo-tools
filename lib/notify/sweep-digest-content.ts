// lib/notify/sweep-digest-content.ts
// Pure digest-email content builder for the weekly client sweep (Task 9).
// No transport, no env, no DB — mirrors lib/notify/content.ts conventions:
// every dynamic string is HTML-escaped in the html body; the text body is
// plain. `appUrl` is the caller's already-trimmed `NEXT_PUBLIC_APP_URL` or
// null; when null, ALL links are omitted (plain text labels remain) rather
// than inventing an origin (Codex plan-fix #19) — this is the ONLY branch
// point for link rendering. Content never claims a scan is "fixed" or
// "improved" — only "no longer detected" / "reported as failed".

import { escapeHtml, escapeAttr } from '@/lib/report/escape'
import type { SweepSnapshot, IssueGroup } from '@/lib/sweep/types'

export interface SweepDigestEmail {
  subject: string
  text: string
  html: string
}

// D6 — the ONLY place the "1 hour" framing lives. This is temporary
// backlog-era copy; retiring it later must be a one-line change here.
export const DIGEST_EFFORT_NUDGE =
  'Pick one item below and put an hour on it this week — start at the top.'

/** Subject-line glyph: ▼n (fewer, good) · ▲n (more, bad) · first baseline (no prior snapshot). */
function fmtDeltaGlyph(delta: number | null): string {
  if (delta === null) return 'first baseline'
  return delta < 0 ? `▼${Math.abs(delta)}` : `▲${delta}`
}

/** Body change-since-last-week sentence; delta===0 gets its own neutral wording. */
function fmtDeltaSentence(delta: number | null): string {
  if (delta === null) return 'first baseline — no comparison'
  if (delta === 0) return 'no change from last week'
  return delta < 0 ? `▼${Math.abs(delta)} fewer than last week` : `▲${delta} more than last week`
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/** Factual (non-causal) ranking descriptor: severity · changeState · count+unit. Never speculates on cause. */
function rankingDescriptor(g: IssueGroup): string {
  return `${cap(g.severity)} · ${g.changeState} · ${g.affectedCount} ${g.unit}`
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function auditUrl(base: string | null, siteAuditId: string | null): string | null {
  if (!base || !siteAuditId) return null
  return `${base}/ada-audit/site/${siteAuditId}`
}

export function buildSweepDigestEmail(snapshot: SweepSnapshot, appUrl: string | null): SweepDigestEmail {
  const { totals, shortlist, resolvedGroups } = snapshot
  const base = appUrl ? trimTrailingSlash(appUrl) : null
  const issuesUrl = base ? `${base}/issues` : null

  const subject = `Weekly scan digest — ${totals.actionable} actionable issues (${fmtDeltaGlyph(totals.delta)})`

  const totalsLine = `${totals.actionable} actionable issue${totals.actionable === 1 ? '' : 's'} across ${totals.comparablePairs} comparable domain/tool observation${totals.comparablePairs === 1 ? '' : 's'}.`
  const changeLine = `Change since last week: ${fmtDeltaSentence(totals.delta)}`
  const coverageLine = `${totals.scanned}/${totals.expected} scanned · ${totals.comparableDomains} comparable · ${totals.partialDomains} partial · ${totals.failedDomains} failed`

  const hasShortlist = shortlist.length > 0
  const EMPTY_SHORTLIST_MSG = 'No new or worsened issues this week.'

  const resolvedLine = resolvedGroups.length > 0
    ? `${resolvedGroups.length} issue${resolvedGroups.length === 1 ? '' : 's'} no longer detected since last week — unverified, please confirm before closing out.`
    : null

  const footerLines = [
    'Failed or partial scans are reported as failed/partial, never presented as improvement.',
    'Issues marked "no longer detected" are not a confirmed resolution — verify manually.',
  ]

  // --- text body ---
  const tLines: string[] = [totalsLine, changeLine, '', `Coverage: ${coverageLine}`, '']
  if (hasShortlist) {
    tLines.push('Top issues this week:', '')
    shortlist.forEach((g, i) => {
      const url = auditUrl(base, g.siteAuditId)
      tLines.push(`${i + 1}. ${g.clientName} (${g.domain}) — ${g.title}: ${rankingDescriptor(g)}`)
      if (url) tLines.push(`   ${url}`)
    })
    tLines.push('', DIGEST_EFFORT_NUDGE)
  } else {
    tLines.push(EMPTY_SHORTLIST_MSG)
  }
  tLines.push('')
  if (resolvedLine) tLines.push(resolvedLine, '')
  tLines.push(...footerLines)
  if (issuesUrl) tLines.push('', `View all issues: ${issuesUrl}`)

  const text = tLines.join('\n')

  // --- html body ---
  const shortlistHtml = hasShortlist
    ? `<ol style="margin:0;padding-left:20px;">${shortlist
        .map((g) => {
          const url = auditUrl(base, g.siteAuditId)
          const label = `<strong>${escapeHtml(g.clientName)}</strong> (${escapeHtml(g.domain)}) — ${escapeHtml(g.title)}: ${escapeHtml(rankingDescriptor(g))}`
          const link = url ? `<br /><a href="${escapeAttr(url)}">View audit</a>` : ''
          return `<li style="margin-bottom:10px;">${label}${link}</li>`
        })
        .join('')}</ol>`
    : `<p style="margin:0;">${escapeHtml(EMPTY_SHORTLIST_MSG)}</p>`

  const nudgeHtml = hasShortlist
    ? `<p style="margin:16px 0 0;font-weight:600;">${escapeHtml(DIGEST_EFFORT_NUDGE)}</p>`
    : ''
  const resolvedHtml = resolvedLine ? `<p style="margin:12px 0 0;">${escapeHtml(resolvedLine)}</p>` : ''
  const issuesLinkHtml = issuesUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeAttr(issuesUrl)}">View all issues</a></p>`
    : ''

  const html = `<div>
    <p style="margin:0 0 8px;">${escapeHtml(totalsLine)}</p>
    <p style="margin:0 0 8px;">${escapeHtml(changeLine)}</p>
    <p style="margin:0 0 16px;color:#6b7280;">Coverage: ${escapeHtml(coverageLine)}</p>
    ${shortlistHtml}
    ${nudgeHtml}
    ${resolvedHtml}
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">${footerLines.map((l) => escapeHtml(l)).join('<br />')}</p>
    ${issuesLinkHtml}
  </div>`

  return { subject, text, html }
}
