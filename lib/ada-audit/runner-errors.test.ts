import { describe, it, expect } from 'vitest'
import { classifyRunnerError } from './runner-errors'
import { SafeUrlError } from '@/lib/security/safe-url'

describe('classifyRunnerError', () => {
  it('classifies Chrome/pool/protocol as infrastructure', () => {
    expect(classifyRunnerError(new Error('Protocol error (Target.createTarget): ...')).kind).toBe('infrastructure')
    expect(classifyRunnerError(new Error('Target closed')).kind).toBe('infrastructure')
    expect(classifyRunnerError(new Error('Session closed. Most likely the page has been closed.')).kind).toBe('infrastructure')
  })
  it('parses HTTP status errors', () => {
    expect(classifyRunnerError(new Error('HTTP 404 — Redirected to ...'))).toEqual({ kind: 'http-status', status: 404 })
    expect(classifyRunnerError(new Error('HTTP 410 — ...'))).toEqual({ kind: 'http-status', status: 410 })
    expect(classifyRunnerError(new Error('HTTP 500 — Internal Server Error'))).toEqual({ kind: 'http-status', status: 500 })
    expect(classifyRunnerError(new Error('HTTP 403 — This site is blocking automated scanners.'))).toEqual({ kind: 'http-status', status: 403 })
  })
  it('classifies non-HTML and timeout distinctly', () => {
    expect(classifyRunnerError(new Error('Response is not HTML (Content-Type: application/rss+xml)')).kind).toBe('non-html')
    expect(classifyRunnerError(new Error('Navigation timeout of 30000 ms exceeded')).kind).toBe('timeout')
  })
  it('maps only policy SafeUrlError to ssrf', () => {
    expect(classifyRunnerError(new SafeUrlError('blocked', 'policy')).kind).toBe('ssrf')
    expect(classifyRunnerError(new SafeUrlError('dns fail', 'dns')).kind).toBe('other')
    expect(classifyRunnerError(new SafeUrlError('bad redirect', 'redirect')).kind).toBe('other')
  })
  it('defaults unknown to other', () => {
    expect(classifyRunnerError(new Error('something else')).kind).toBe('other')
    expect(classifyRunnerError('a string').kind).toBe('other')
    expect(classifyRunnerError(null).kind).toBe('other')
  })
})
