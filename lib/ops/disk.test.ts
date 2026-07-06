import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fsp from 'fs/promises'
import { getDiskFree } from './disk'

vi.mock('fs/promises', () => ({ statfs: vi.fn() }))

describe('getDiskFree', () => {
  beforeEach(() => { vi.mocked(fsp.statfs).mockReset() })

  it('returns bavail * bsize', async () => {
    vi.mocked(fsp.statfs).mockResolvedValue({ bavail: 1000, bsize: 4096 } as never)
    expect(await getDiskFree('/data')).toBe(1000 * 4096)
  })

  it('returns null when statfs throws', async () => {
    vi.mocked(fsp.statfs).mockRejectedValue(new Error('ENOSYS'))
    expect(await getDiskFree('/data')).toBeNull()
  })
})
