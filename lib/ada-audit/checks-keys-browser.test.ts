import { describe, expect, it } from 'vitest'
import * as server from './checks-keys'
import * as browser from './checks-keys-browser'

describe('browser/server key parity', () => {
  it('keyForNode matches', async () => {
    const s = server.keyForNode({ ruleId: 'r', target: ['t', 'u'] })
    const b = await browser.keyForNode({ ruleId: 'r', target: ['t', 'u'] })
    expect(s).toBe(b)
  })

  it('keyForPage matches', async () => {
    expect(server.keyForPage({ pageUrl: '/a' })).toBe(await browser.keyForPage({ pageUrl: '/a' }))
  })

  it('keyForPageViolation matches', async () => {
    expect(server.keyForPageViolation({ pageUrl: '/a', ruleId: 'r' })).toBe(await browser.keyForPageViolation({ pageUrl: '/a', ruleId: 'r' }))
  })
})
