import { describe, it, expect } from 'vitest'
import { isTransientRunnerError } from './runner-retry'

describe('isTransientRunnerError', () => {
  it('matches Puppeteer navigation timeout', () => {
    expect(isTransientRunnerError(new Error('Navigation timeout of 30000 ms exceeded'))).toBe(true)
  })

  it('matches Puppeteer frame-detached error', () => {
    expect(isTransientRunnerError(new Error('Navigating frame was detached'))).toBe(true)
  })

  it('matches Chrome cert verifier transient', () => {
    expect(isTransientRunnerError(new Error('net::ERR_CERT_VERIFIER_CHANGED at https://x.example/'))).toBe(true)
  })

  it('does NOT match HTTP status errors', () => {
    expect(isTransientRunnerError(new Error('HTTP 403 — This site is blocking automated scanners'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 404 — Not Found'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 500 — Internal Server Error'))).toBe(false)
    expect(isTransientRunnerError(new Error('HTTP 304 Not Modified — retry also returned no response'))).toBe(false)
  })

  it('does NOT match SSRF or content-type errors', () => {
    expect(isTransientRunnerError(new Error('Blocked unsafe navigation request to internal IP'))).toBe(false)
    expect(isTransientRunnerError(new Error('Response is not HTML (Content-Type: application/json)'))).toBe(false)
  })

  it('handles non-Error inputs', () => {
    expect(isTransientRunnerError('Navigation timeout of 30000 ms exceeded')).toBe(true)
    expect(isTransientRunnerError(null)).toBe(false)
    expect(isTransientRunnerError(undefined)).toBe(false)
    expect(isTransientRunnerError({ message: 'Navigation timeout of 30000 ms exceeded' })).toBe(false)
  })
})
