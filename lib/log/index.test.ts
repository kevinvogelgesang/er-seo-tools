import { describe, it, expect, vi } from 'vitest'
import { serializeError, logError, logger } from './index'

describe('serializeError', () => {
  it('extracts name/message/stack from an Error', () => {
    const e = new Error('boom')
    const s = serializeError(e)
    expect(s.message).toBe('boom')
    expect(s.name).toBe('Error')
    expect(typeof s.stack).toBe('string')
  })

  it('stringifies a non-Error', () => {
    expect(serializeError('nope')).toEqual({ message: 'nope' })
    expect(serializeError(42)).toEqual({ message: '42' })
  })

  it('does not leak arbitrary enumerable props of an error-like object', () => {
    const gaxiosLike = Object.assign(new Error('bad'), { config: { headers: { authorization: 'secret' } } })
    const s = serializeError(gaxiosLike)
    expect(s).not.toHaveProperty('config')
    expect(JSON.stringify(s)).not.toContain('secret')
  })
})

describe('logError', () => {
  it('emits context + serialized err via logger.error', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    logError({ jobId: 'j1', type: 'psi', attempt: 2 }, new Error('kaboom'))
    expect(spy).toHaveBeenCalledTimes(1)
    const arg = spy.mock.calls[0][0] as Record<string, unknown>
    expect(arg.jobId).toBe('j1')
    expect(arg.type).toBe('psi')
    expect((arg.err as { message: string }).message).toBe('kaboom')
    spy.mockRestore()
  })

  it('never throws into the caller even if logger.error throws', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => { throw new Error('EPIPE') })
    expect(() => logError({ jobId: 'j2' }, new Error('boom'))).not.toThrow()
    spy.mockRestore()
  })
})

describe('logger construction', () => {
  it('does not throw at import with an invalid LOG_LEVEL', async () => {
    vi.resetModules()
    const prev = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'bogus-level'
    try {
      const mod = await import('./index')
      expect(mod.logger).toBeDefined()
      expect(() => mod.logError({ a: 1 }, new Error('x'))).not.toThrow()
    } finally {
      process.env.LOG_LEVEL = prev
      vi.resetModules()
    }
  })
})
