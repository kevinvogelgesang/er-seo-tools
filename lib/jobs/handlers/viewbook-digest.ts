import { runViewbookDigests } from '@/lib/viewbook/digest'
import { VIEWBOOK_DIGEST_JOB_TYPE } from '../types'
import { registerJobHandler } from '../registry'

export { VIEWBOOK_DIGEST_JOB_TYPE }

export async function runViewbookDigestJob(payload: unknown): Promise<void> {
  if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) {
    throw new Error('Invalid viewbook-digest job payload')
  }
  await runViewbookDigests()
}

export function registerViewbookDigestHandler(): void {
  registerJobHandler({
    type: VIEWBOOK_DIGEST_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: (payload) => runViewbookDigestJob(payload),
  })
}
