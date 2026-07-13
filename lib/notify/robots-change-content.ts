// lib/notify/robots-change-content.ts
//
// D5 pure change-alert email builder. Every dynamic string HTML-escaped in
// the html body; the text body is plain. Transport-honest wording (spec
// Codex #7): status transitions are phrased as monitor OBSERVATIONS
// ("robots.txt could not be fetched (timeout)"), never as site-configuration
// claims ("robots.txt was removed").

import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
import type { EmailContent } from './content'

export interface RobotsChangeEmailInput {
  clientName: string
  clientId: number
  domain: string
  summary: RobotsChangeSummary
  /** detail.robots.failure of the CURRENT check — taxonomy for the wording. */
  currFailure: string | null
  appUrl: string | null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function statusPhrase(status: string, failure: string | null): string {
  if (status === 'ok') return 'robots.txt is reachable'
  if (status === 'missing') return 'robots.txt responded 404/410 (missing)'
  return `robots.txt could not be fetched${failure ? ` (${failure})` : ''}`
}

export function buildRobotsChangeEmail(input: RobotsChangeEmailInput): EmailContent {
  const { summary: s } = input
  // Parallel text/html section lists; html entries are pre-escaped.
  const text: string[] = []
  const html: string[] = []
  const push = (t: string, h?: string) => { text.push(t); html.push(h ?? `<p>${esc(t)}</p>`) }

  push(`Robots/sitemap state changed for ${input.clientName} (${input.domain}).`)

  if (s.robotsStatus) {
    push(`Status: was "${statusPhrase(s.robotsStatus.prev, null)}", now "${statusPhrase(s.robotsStatus.curr, input.currFailure)}".`)
  }

  if (s.robotsDiff && (s.robotsDiff.added.length || s.robotsDiff.removed.length)) {
    const addedT = s.robotsDiff.added.map((l) => `+ ${l}`).join('\n')
    const removedT = s.robotsDiff.removed.map((l) => `- ${l}`).join('\n')
    const both = [removedT, addedT].filter(Boolean).join('\n')
    const trunc = s.robotsDiff.truncated ? '\n(diff truncated)' : ''
    text.push(`robots.txt line changes:\n${both}${trunc}`)
    const addedH = s.robotsDiff.added.map((l) => `<div style="color:#166534">+ ${esc(l)}</div>`).join('')
    const removedH = s.robotsDiff.removed.map((l) => `<div style="color:#991b1b">- ${esc(l)}</div>`).join('')
    html.push(`<p>robots.txt line changes:</p><div style="font-family:monospace;font-size:12px">${removedH}${addedH}</div>${s.robotsDiff.truncated ? '<p>(diff truncated)</p>' : ''}`)
  } else if (s.robotsContentChanged && s.robotsDiff) {
    // Non-null but EMPTY diff = both bodies were available and multiset-equal.
    push('robots.txt content changed (reordering or formatting only — no lines added or removed).')
  } else if (s.robotsContentChanged) {
    // Null diff = a raw body was unavailable (e.g. ok -> unreachable). Never
    // claim formatting-only without evidence (plan-Codex #3).
    push('robots.txt content changed; line diff unavailable.')
  }

  if (s.blockedBots) {
    if (s.blockedBots.added.length) push(`AI bots newly blocked: ${s.blockedBots.added.join(', ')}`)
    if (s.blockedBots.removed.length) push(`AI bots no longer blocked: ${s.blockedBots.removed.join(', ')}`)
  }

  if (s.sitemaps) {
    for (const url of s.sitemaps.added) push(`Sitemap added: ${url}`)
    for (const url of s.sitemaps.removed) push(`Sitemap no longer listed: ${url}`)
    for (const c of s.sitemaps.changed) {
      const countPart = c.urlCountPrev !== c.urlCountCurr ? ` (URLs ${c.urlCountPrev ?? '?'} -> ${c.urlCountCurr ?? '?'})` : ''
      const childPart = c.childrenChanged ? ' (child sitemaps changed)' : ''
      push(`Sitemap content changed: ${c.url}${countPart}${childPart}`)
    }
    if (s.sitemaps.orderChanged) push('Sitemap declaration order changed (same set).')
  }

  if (s.sitemapUrlTotal) {
    push(`Total sitemap URLs: ${s.sitemapUrlTotal.prev ?? 'none observed'} -> ${s.sitemapUrlTotal.curr ?? 'none observed'}.`)
  }
  if (s.counts) {
    push(`Validation counts: errors ${s.counts.errorsPrev} -> ${s.counts.errorsCurr}, warnings ${s.counts.warningsPrev} -> ${s.counts.warningsCurr}.`)
  }

  if (input.appUrl) {
    const link = `${input.appUrl}/clients/${input.clientId}`
    text.push(`Full history: ${link}`)
    html.push(`<p><a href="${esc(link)}">Open the client's check history</a></p>`)
  }

  return {
    subject: `Robots/sitemap change: ${input.domain}`,
    text: text.join('\n\n'),
    html: `<div style="font-family:sans-serif;max-width:640px">${html.join('')}</div>`,
  }
}
