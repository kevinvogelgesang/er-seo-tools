import { describe, expect, it } from 'vitest'
import {
  buildPcCompleteEmail,
  buildStageChangeEmail,
  buildTeamInviteEmail,
} from './viewbook-email-content'

describe('viewbook email content', () => {
  it('builds a team invite with subject, branded bodies, and invite URL', () => {
    const content = buildTeamInviteEmail({
      viewbookTitle: 'Acme Project Viewbook',
      inviteUrl: 'https://app.example.com/viewbook/invite-token',
      clientName: 'Acme College',
    })
    expect(content.subject).toContain("You've been invited to Acme College's viewbook")
    expect(content.html).toContain('https://app.example.com/viewbook/invite-token')
    expect(content.text).toContain('https://app.example.com/viewbook/invite-token')
    expect(content.html).toContain('Acme Project Viewbook')
    expect(content.text).toContain('Acme Project Viewbook')
  })

  it('builds a post-contract completion email with the viewbook URL', () => {
    const content = buildPcCompleteEmail({
      viewbookTitle: 'Acme Project Viewbook',
      viewbookUrl: 'https://app.example.com/viewbook/acme-token',
      clientName: 'Acme College',
    })
    expect(content.subject).toContain('Acme College finished their post-contract setup')
    expect(content.html).toContain('https://app.example.com/viewbook/acme-token')
    expect(content.text).toContain('https://app.example.com/viewbook/acme-token')
  })

  it('builds a stage-change email with the entered stage and viewbook URL', () => {
    const content = buildStageChangeEmail({
      stageLabel: 'Project Kickoff',
      viewbookTitle: 'Acme Project Viewbook',
      viewbookUrl: 'https://app.example.com/viewbook/acme-token',
      clientName: 'Acme College',
    })
    expect(content.subject).toContain('Your project has moved to Project Kickoff')
    expect(content.html).toContain('Project Kickoff')
    expect(content.text).toContain('Project Kickoff')
    expect(content.html).toContain('https://app.example.com/viewbook/acme-token')
    expect(content.text).toContain('https://app.example.com/viewbook/acme-token')
  })

  it('HTML-escapes hostile dynamic names while preserving literal plaintext', () => {
    const hostile = '<img src=x>'
    const content = buildStageChangeEmail({
      stageLabel: 'Kickoff',
      viewbookTitle: `${hostile} Viewbook`,
      viewbookUrl: 'https://app.example.com/viewbook/token',
      clientName: hostile,
    })
    expect(content.html).toContain('&lt;img')
    expect(content.html).not.toContain(hostile)
    expect(content.text).toContain(hostile)
    expect(content.text).not.toContain('&lt;img')
  })
})
