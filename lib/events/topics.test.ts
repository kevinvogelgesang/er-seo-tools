import { describe, it, expect } from 'vitest'
import { queueTopic, siteAuditTopic, adaAuditTopic } from './topics'

describe('topics', () => {
  it('are stable literal strings not derived from identifier names', () => {
    expect(queueTopic()).toBe('queue')
    expect(siteAuditTopic(42)).toBe('site-audit:42')
    expect(adaAuditTopic('7')).toBe('ada-audit:7')
  })
})
