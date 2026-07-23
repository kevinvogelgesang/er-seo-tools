import type { EmailContent } from './content'

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const COLOR = {
  navy: '#1c2d4a',
  pageBg: '#f4f5f7',
  hair: '#e5e7eb',
  ink: '#111827',
  sub: '#6b7280',
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
        <tr><td style="background:${COLOR.navy};padding:16px 24px;font-size:16px;font-weight:700;color:#ffffff;">Enrollment Resources</td></tr>
        <tr><td style="padding:24px;">${inner}</td></tr>
      </table>
    </td></tr></table>`
}

interface TeamInviteInput {
  viewbookTitle: string
  inviteUrl: string
  clientName: string
}

export function buildTeamInviteEmail(input: TeamInviteInput): EmailContent {
  const subject = `You've been invited to ${input.clientName}'s onboarding viewbook`
  const html = shellHtml(`<h1 style="margin:0 0 12px;font-size:22px;">${esc(input.viewbookTitle)}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLOR.sub};">Join ${esc(input.clientName)} in their onboarding viewbook.</p>
    ${buttonHtml(input.inviteUrl, 'Open your onboarding viewbook')}
    <p style="margin:16px 0 0;font-size:12px;color:${COLOR.sub};">This link expires in 7 days — you can always request a fresh one from the viewbook page.</p>`)
  const text = [subject, '', input.viewbookTitle, `Join ${input.clientName} in their onboarding viewbook.`, 'This link expires in 7 days — you can always request a fresh one from the viewbook page.', '', `Open your onboarding viewbook: ${input.inviteUrl}`].join('\n')
  return { subject, html, text }
}

interface MagicLinkInput {
  viewbookTitle: string
  grantUrl: string
  clientName: string
}

export function buildMagicLinkEmail(input: MagicLinkInput): EmailContent {
  const subject = `Here's your sign-in link for ${input.clientName}'s onboarding viewbook`
  const html = shellHtml(`<h1 style="margin:0 0 12px;font-size:22px;">${esc(input.viewbookTitle)}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLOR.sub};">Use the button below to sign in. The link expires in 7 days — you can always request a fresh one from the viewbook page.</p>
    ${buttonHtml(input.grantUrl, 'Open your onboarding viewbook')}`)
  const text = [
    subject,
    '',
    input.viewbookTitle,
    'The link expires in 7 days — request a fresh one from the viewbook page any time.',
    '',
    `Sign in: ${input.grantUrl}`,
  ].join('\n')
  return { subject, html, text }
}

interface PcCompleteInput {
  viewbookTitle: string
  viewbookUrl: string
  clientName: string
}

export function buildPcCompleteEmail(input: PcCompleteInput): EmailContent {
  const subject = `${input.clientName} finished their post-contract setup`
  const html = shellHtml(`<h1 style="margin:0 0 12px;font-size:22px;">Post-contract setup complete</h1>
    <p style="margin:0 0 8px;font-size:14px;"><strong>${esc(input.clientName)}</strong> finished their post-contract setup.</p>
    <p style="margin:0 0 20px;font-size:14px;color:${COLOR.sub};">${esc(input.viewbookTitle)}</p>
    ${buttonHtml(input.viewbookUrl, 'Open the viewbook')}`)
  const text = [subject, '', `${input.clientName} finished their post-contract setup.`, input.viewbookTitle, '', `Open the viewbook: ${input.viewbookUrl}`].join('\n')
  return { subject, html, text }
}

interface StageChangeInput {
  stageLabel: string
  viewbookTitle: string
  viewbookUrl: string
  clientName: string
}

export function buildStageChangeEmail(input: StageChangeInput): EmailContent {
  const subject = `Your project has moved to ${input.stageLabel}`
  const html = shellHtml(`<h1 style="margin:0 0 12px;font-size:22px;">${esc(subject)}</h1>
    <p style="margin:0 0 8px;font-size:14px;">${esc(input.clientName)}'s project is now in <strong>${esc(input.stageLabel)}</strong>.</p>
    <p style="margin:0 0 20px;font-size:14px;color:${COLOR.sub};">${esc(input.viewbookTitle)}</p>
    ${buttonHtml(input.viewbookUrl, 'Open the viewbook')}`)
  const text = [subject, '', `${input.clientName}'s project is now in ${input.stageLabel}.`, input.viewbookTitle, '', `Open the viewbook: ${input.viewbookUrl}`].join('\n')
  return { subject, html, text }
}
