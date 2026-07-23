import { beforeEach, describe, expect, it, vi } from 'vitest'

const pruneViewbookActivityMock = vi.fn().mockResolvedValue(0)
const pruneViewbookAuthRowsMock = vi.fn().mockResolvedValue({ grants: 0, sessions: 0, requests: 0 })

vi.mock('@/lib/viewbook/retention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/viewbook/retention')>()
  return {
    ...actual,
    pruneViewbookActivity: (...args: unknown[]) => pruneViewbookActivityMock(...args),
  }
})

vi.mock('@/lib/viewbook/auth-retention', () => ({
  pruneViewbookAuthRows: (...args: unknown[]) => pruneViewbookAuthRowsMock(...args),
}))

import { runCleanup } from '@/lib/cleanup'

describe('runCleanup viewbook wiring', () => {
  beforeEach(() => {
    pruneViewbookActivityMock.mockClear()
    pruneViewbookAuthRowsMock.mockClear()
  })

  it('invokes the 180-day viewbook activity pruner once with the cleanup time', async () => {
    await runCleanup()
    expect(pruneViewbookActivityMock).toHaveBeenCalledTimes(1)
    expect(pruneViewbookActivityMock.mock.calls[0][0]).toBeInstanceOf(Date)
  })

  it('invokes the viewbook auth-row pruner once with the cleanup time', async () => {
    await runCleanup()
    expect(pruneViewbookAuthRowsMock).toHaveBeenCalledTimes(1)
    expect(pruneViewbookAuthRowsMock.mock.calls[0][0]).toBeInstanceOf(Date)
  })
})
