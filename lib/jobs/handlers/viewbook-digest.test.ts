import { describe, expect, it } from 'vitest'
import { getJobHandler } from '../registry'
import { registerViewbookDigestHandler, VIEWBOOK_DIGEST_JOB_TYPE } from './viewbook-digest'

describe('viewbook-digest job registration', () => {
  it('registers concurrency 1, three attempts, and no group semantics', () => {
    registerViewbookDigestHandler()
    const handler = getJobHandler(VIEWBOOK_DIGEST_JOB_TYPE)
    expect(handler).toBeDefined()
    expect(handler?.concurrency).toBe(1)
    expect(handler?.maxAttempts).toBe(3)
    expect(handler?.timeoutMs).toBe(120_000)
  })
})
