// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

describe('per-worker DB binding', () => {
  it('this worker uses its own DB file (not a shared one)', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ seq: number; name: string; file: string }>>(
      'PRAGMA database_list'
    )
    const main = rows.find((r) => r.name === 'main') ?? rows[0]
    const file = main?.file ?? ''
    const id = process.env.VITEST_WORKER_ID ?? '1'
    expect(file).toContain('.test-dbs')
    expect(file).toContain(`worker-${id}.db`)
  })
})
