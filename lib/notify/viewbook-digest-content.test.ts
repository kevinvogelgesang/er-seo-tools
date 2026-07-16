import { describe, expect, it } from 'vitest'
import { buildViewbookDigestEmail } from './viewbook-digest-content'

describe('buildViewbookDigestEmail', () => {
  it('HTML-escapes summaries and renders the honest overflow line', () => {
    const content = buildViewbookDigestEmail({
      clientName: 'A&B <College>',
      items: [{ summary: '<script>alert("x")</script>', actor: 'client', createdAt: new Date() }],
      overflowCount: 7,
      activityUrl: 'https://app.example.com/viewbooks/1?tab=activity&x="bad"',
    })
    expect(content.text).toContain('<script>alert("x")</script>')
    expect(content.text).toContain('+7 more in the activity feed')
    expect(content.html).toContain('&lt;script&gt;')
    expect(content.html).toContain('A&amp;B &lt;College&gt;')
    expect(content.html).not.toContain('<script>')
    expect(content.html).toContain('&quot;bad&quot;')
  })

  it('byte-caps oversized summaries with an ellipsis', () => {
    const content = buildViewbookDigestEmail({
      clientName: 'Client', items: [{ summary: '😀'.repeat(300), actor: 'client', createdAt: new Date() }],
      overflowCount: 0, activityUrl: null,
    })
    expect(Buffer.byteLength(content.text, 'utf8')).toBeLessThan(700)
    expect(content.text).toContain('…')
  })
})
