// lib/jobs/registry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerJobHandler,
  getJobHandler,
  listJobTypes,
  clearJobRegistryForTests,
  runOnExhausted,
} from './registry'

describe('jobs/registry', () => {
  beforeEach(() => clearJobRegistryForTests())

  it('applies defaults and resolves a registered handler', () => {
    registerJobHandler({ type: 'test-reg', concurrency: 2, handler: async () => {} })
    const cfg = getJobHandler('test-reg')
    expect(cfg).toBeDefined()
    expect(cfg?.concurrency).toBe(2)
    expect(cfg?.maxAttempts).toBe(3)
    expect(cfg?.backoffBaseMs).toBe(30_000)
    expect(cfg?.timeoutMs).toBe(5 * 60 * 1000)
    expect(listJobTypes()).toEqual(['test-reg'])
  })

  it('re-registration overwrites (idempotent startup)', () => {
    registerJobHandler({ type: 'test-reg', concurrency: 1, handler: async () => {} })
    registerJobHandler({ type: 'test-reg', concurrency: 4, handler: async () => {} })
    expect(getJobHandler('test-reg')?.concurrency).toBe(4)
    expect(listJobTypes()).toEqual(['test-reg'])
  })

  it('runOnExhausted parses payload and calls the hook', async () => {
    const onExhausted = vi.fn(async () => {})
    registerJobHandler({ type: 'test-ex', concurrency: 1, handler: async () => {}, onExhausted })
    await runOnExhausted('test-ex', '{"a":1}', 'job-1', 2, 'boom')
    expect(onExhausted).toHaveBeenCalledWith({ a: 1 }, { jobId: 'job-1', attempts: 2, lastError: 'boom' })
  })

  it('runOnExhausted is a no-op without a hook and swallows hook errors', async () => {
    registerJobHandler({ type: 'test-noop', concurrency: 1, handler: async () => {} })
    await expect(runOnExhausted('test-noop', '{}', 'j', 1, 'x')).resolves.toBeUndefined()
    registerJobHandler({
      type: 'test-throws', concurrency: 1, handler: async () => {},
      onExhausted: async () => { throw new Error('hook failed') },
    })
    await expect(runOnExhausted('test-throws', 'not-json', 'j', 1, 'x')).resolves.toBeUndefined()
    await expect(runOnExhausted('test-unknown-type', '{}', 'j', 1, 'x')).resolves.toBeUndefined()
  })
})
