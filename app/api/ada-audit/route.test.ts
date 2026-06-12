// app/api/ada-audit/route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const adaCreateMock = vi.fn()
const clientFindManyMock = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { create: (...a: unknown[]) => adaCreateMock(...a) },
    client: { findMany: (...a: unknown[]) => clientFindManyMock(...a) },
  },
}))

const enqueueJobMock = vi.fn()
vi.mock('@/lib/jobs/queue', () => ({
  enqueueJob: (...a: unknown[]) => enqueueJobMock(...a),
}))

const failStandaloneAuditMock = vi.fn()
// Partial mock: keep the real ADA_AUDIT_JOB_TYPE export so the test can't
// drift from the actual job-type constant (Codex plan fix #4).
vi.mock('@/lib/jobs/handlers/ada-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/handlers/ada-audit')>()
  return {
    ...actual,
    failStandaloneAudit: (...a: unknown[]) => failStandaloneAuditMock(...a),
  }
})

import { POST } from './route'
import { NextRequest } from 'next/server'
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

function makeRequest(body: unknown, operator?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (operator) headers.set('cookie', `${OPERATOR_NAME_COOKIE_NAME}=${operator}`)
  return new NextRequest('http://localhost/api/ada-audit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/ada-audit', () => {
  beforeEach(() => {
    adaCreateMock.mockReset()
    clientFindManyMock.mockReset()
    enqueueJobMock.mockReset()
    failStandaloneAuditMock.mockReset()
    clientFindManyMock.mockResolvedValue([])
    adaCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'audit-1', ...data,
    }))
    enqueueJobMock.mockResolvedValue({ id: 'job-1', deduped: false })
    failStandaloneAuditMock.mockResolvedValue(undefined)
  })

  it('creates the row (normalized URL, matched client, requestedBy) and enqueues a durable job', async () => {
    clientFindManyMock.mockResolvedValue([
      { id: 7, domains: JSON.stringify(['example.com']) },
      { id: 9, domains: JSON.stringify(['other.com']) },
    ])
    const res = await POST(makeRequest({ url: 'www.example.com/page' }, 'Kevin'))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ id: 'audit-1', status: 'pending' })
    // Archived clients are excluded at the query (Codex spec fix #7).
    expect(clientFindManyMock).toHaveBeenCalledWith({
      where: { archivedAt: null },
      select: { id: true, domains: true },
    })
    expect(adaCreateMock).toHaveBeenCalledWith({
      data: {
        url: 'https://www.example.com/page',
        status: 'pending',
        clientId: 7,
        wcagLevel: 'wcag21aa',
        requestedBy: 'Kevin',
      },
    })
    expect(enqueueJobMock).toHaveBeenCalledWith({
      type: 'ada-audit',
      payload: { adaAuditId: 'audit-1', url: 'https://www.example.com/page', wcagLevel: 'wcag21aa' },
      dedupKey: 'ada-audit:audit-1',
      groupKey: 'ada-audit:audit-1',
    })
  })

  it('respects wcag22aa', async () => {
    await POST(makeRequest({ url: 'example.com', wcagLevel: 'wcag22aa' }))
    expect(adaCreateMock.mock.calls[0][0].data.wcagLevel).toBe('wcag22aa')
    expect(enqueueJobMock.mock.calls[0][0].payload.wcagLevel).toBe('wcag22aa')
  })

  it('enqueue failure: awaits the error fallback and returns 500', async () => {
    enqueueJobMock.mockRejectedValue(new Error('db down'))
    const res = await POST(makeRequest({ url: 'example.com' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to queue audit' })
    expect(failStandaloneAuditMock).toHaveBeenCalledWith('audit-1', 'Failed to enqueue audit job')
  })

  it('enqueue failure with a failing fallback still returns 500', async () => {
    enqueueJobMock.mockRejectedValue(new Error('db down'))
    failStandaloneAuditMock.mockRejectedValue(new Error('also down'))
    const res = await POST(makeRequest({ url: 'example.com' }))
    expect(res.status).toBe(500)
  })

  it('rejects invalid JSON and missing url without enqueuing', async () => {
    const bad = new NextRequest('http://localhost/api/ada-audit', { method: 'POST', body: 'not json' })
    expect((await POST(bad)).status).toBe(400)
    expect((await POST(makeRequest({}))).status).toBe(400)
    expect((await POST(makeRequest({ url: 'ftp://x.example/a' }))).status).toBe(400)
    expect((await POST(makeRequest({ url: 'localhost' }))).status).toBe(400)
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })
})
