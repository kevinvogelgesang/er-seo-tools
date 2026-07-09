import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionFindUniqueMock = vi.fn()
const sessionCreateMock = vi.fn()
const sessionUpdateMock = vi.fn()
const getOperatorLabelMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args),
      create: (...args: unknown[]) => sessionCreateMock(...args),
      update: (...args: unknown[]) => sessionUpdateMock(...args),
    },
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>()
  return { ...mod, getOperatorLabel: (...args: unknown[]) => getOperatorLabelMock(...args) }
})

import { POST } from './route'

const ORIG_ENV = { ...process.env }

function uploadRequest(fields: Record<string, string> = {}): NextRequest {
  const form = new FormData()
  form.append('file', new Blob(['id\n1']), 'internal_all.csv')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: {
      'content-length': '512',
      'x-forwarded-for': '203.0.113.11',
    },
    body: form,
  })
}

describe('POST /api/upload — requestedBy stamping (C16)', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV, UPLOAD_MAX_BODY_BYTES: '1024' }
    sessionFindUniqueMock.mockReset().mockResolvedValue(null)
    sessionCreateMock.mockReset().mockResolvedValue({})
    sessionUpdateMock.mockReset().mockResolvedValue({})
    getOperatorLabelMock.mockReset().mockResolvedValue('Kevin Vogelgesang')
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
    vi.restoreAllMocks()
  })

  it('stamps requestedBy from getOperatorLabel on session CREATE', async () => {
    const res = await POST(uploadRequest())
    expect(res.status).toBe(200)
    expect(sessionCreateMock).toHaveBeenCalledTimes(1)
    expect(sessionCreateMock.mock.calls[0][0].data.requestedBy).toBe('Kevin Vogelgesang')
  })

  it('APPEND to a pending session never overwrites requestedBy (Codex fix #7)', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: '123e4567-e89b-12d3-a456-426614174000',
      status: 'pending',
      files: JSON.stringify(['earlier.csv']),
    })
    getOperatorLabelMock.mockResolvedValue('Somebody Else')
    const res = await POST(uploadRequest({ sessionId: '123e4567-e89b-12d3-a456-426614174000' }))
    expect(res.status).toBe(200)
    expect(sessionCreateMock).not.toHaveBeenCalled()
    expect(sessionUpdateMock).toHaveBeenCalledTimes(1)
    expect(sessionUpdateMock.mock.calls[0][0].data).not.toHaveProperty('requestedBy')
  })

  it('null label → null requestedBy (legacy sessions never match Mine)', async () => {
    getOperatorLabelMock.mockResolvedValue(null)
    const res = await POST(uploadRequest())
    expect(res.status).toBe(200)
    expect(sessionCreateMock.mock.calls[0][0].data.requestedBy).toBeNull()
  })
})
