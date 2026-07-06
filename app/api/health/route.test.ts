import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as summary from '@/lib/ops/health-summary'
import { logError } from '@/lib/log'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

describe('GET /api/health', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]) })

  it('200 ok when DB up + no signals', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockResolvedValue({ status: 'ok' })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptimeSec).toBe('number')
    expect(typeof body.version).toBe('string')
  })

  it('200 degraded when a signal trips; body carries only the flag (no alert text)', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockResolvedValue({ status: 'degraded' })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(JSON.stringify(body)).not.toMatch(/audit|job|backup|queue/i)
  })

  it('503 down when the DB ping rejects, and logs the failure', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('db gone'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).status).toBe('down')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(logError).toHaveBeenCalledWith({ scope: 'health-db-ping' }, expect.any(Error))
  })

  it('fails open to 200 ok if the summary throws (does not 500/503)', async () => {
    vi.spyOn(summary, 'getLivenessSummary').mockRejectedValue(new Error('boom'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })
})
