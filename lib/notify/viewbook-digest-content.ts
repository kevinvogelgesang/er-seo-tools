import type { EmailContent } from './content'
import { escapeAttr, escapeHtml } from '@/lib/report/escape'

export interface ViewbookDigestItem {
  summary: string
  actor: string
  createdAt: Date
}

export interface ViewbookDigestInput {
  clientName: string
  items: ViewbookDigestItem[]
  overflowCount: number
  activityUrl: string | null
}

const SUMMARY_BYTE_CAP = 500

function capSummary(summary: string): string {
  if (Buffer.byteLength(summary, 'utf8') <= SUMMARY_BYTE_CAP) return summary
  let value = summary
  while (value && Buffer.byteLength(`${value}…`, 'utf8') > SUMMARY_BYTE_CAP) value = value.slice(0, -1)
  return `${value}…`
}

export function buildViewbookDigestEmail(input: ViewbookDigestInput): EmailContent {
  const summaries = input.items.map((item) => capSummary(item.summary))
  const overflow = input.overflowCount > 0 ? `+${input.overflowCount} more in the activity feed` : null
  const subject = `Onboarding Viewbook activity — ${input.clientName} (${input.items.length + input.overflowCount} updates)`
  const textLines = [
    `${input.clientName} has new viewbook activity.`,
    '',
    ...summaries.map((summary) => `• ${summary}`),
    ...(overflow ? [overflow] : []),
    ...(input.activityUrl ? ['', `View activity: ${input.activityUrl}`] : []),
  ]
  const rows = summaries.map((summary) =>
    `<li style="margin:0 0 10px;white-space:pre-wrap;">${escapeHtml(summary)}</li>`).join('')
  const overflowHtml = overflow ? `<p style="margin:12px 0 0;font-weight:600;">${escapeHtml(overflow)}</p>` : ''
  const linkHtml = input.activityUrl
    ? `<p style="margin:18px 0 0;"><a href="${escapeAttr(input.activityUrl)}">View activity feed</a></p>` : ''
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#111827;">
    <h2 style="margin:0 0 8px;">New viewbook activity</h2>
    <p style="margin:0 0 16px;">${escapeHtml(input.clientName)} has new activity.</p>
    <ul style="margin:0;padding-left:20px;">${rows}</ul>${overflowHtml}${linkHtml}
  </div>`
  return { subject, text: textLines.join('\n'), html }
}
