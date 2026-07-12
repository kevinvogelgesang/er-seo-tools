// lib/jobs/job-topics.test.ts
import { describe, it, expect } from 'vitest'
import { topicForGroup } from './job-topics'

describe('jobs/job-topics', () => {
  it('maps a site-audit group key to the site-audit topic', () => {
    expect(topicForGroup('site-audit:9')).toBe('site-audit:9')
  })

  it('maps an ada-audit group key to the ada-audit topic', () => {
    expect(topicForGroup('ada-audit:5')).toBe('ada-audit:5')
  })

  it('maps a report group key to the report topic', () => {
    expect(topicForGroup('report:3')).toBe('report:3')
  })

  it('maps a seo-report group key to the report topic', () => {
    expect(topicForGroup('seo-report:3')).toBe('report:3')
  })

  it('returns null for an unknown prefix', () => {
    expect(topicForGroup('mystery:1')).toBeNull()
  })

  it('returns null for a null group key', () => {
    expect(topicForGroup(null)).toBeNull()
  })
})
