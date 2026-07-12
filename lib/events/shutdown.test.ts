// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('instrumentation shutdown', () => {
  it('calls shutdownBus before closeBrowser', () => {
    const src = readFileSync('instrumentation.ts', 'utf8')
    const bus = src.indexOf('shutdownBus()')
    const browser = src.indexOf('closeBrowser()')
    expect(bus).toBeGreaterThan(-1)
    expect(bus).toBeLessThan(browser)
  })
})
