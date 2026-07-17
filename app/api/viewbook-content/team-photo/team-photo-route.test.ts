// Route-level tests for POST /api/viewbook-content/team-photo (PR7 task 2):
// pre-buffer size gates — an over-limit Content-Length must 413 before
// request.formData() buffers the body, and an over-limit File.size must 413
// before arrayBuffer() copies it, even when Content-Length is small and
// valid (the multipart boundary can under-report the true body size).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { MAX_ASSET_BYTES } from '@/lib/viewbook/assets'
import { POST as postTeamPhoto } from './route'

const savedEnv: Record<string, string | undefined> = {}
let cookie: string
let assetsDir: string

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET', 'VIEWBOOK_ASSETS_DIR']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-team-photo-route-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:team-photo', email: 'team-photo-route@example.com', hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(assetsDir, { recursive: true, force: true })
})

function uploadRequest(options: { file: File; contentLength?: string }): NextRequest {
  const form = new FormData()
  form.set('memberName', 'Kevin')
  form.set('file', options.file)
  const headers = new Headers({ cookie })
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength)
  return new Request('http://localhost/api/viewbook-content/team-photo', {
    method: 'POST',
    headers,
    body: form,
  }) as unknown as NextRequest
}

describe('POST /api/viewbook-content/team-photo', () => {
  it('rejects an over-limit Content-Length with 413 before buffering', async () => {
    const file = new File([Buffer.from('irrelevant')], 'photo.png', { type: 'image/png' })
    const res = await postTeamPhoto(
      uploadRequest({ file, contentLength: String(MAX_ASSET_BYTES + 64 * 1024 + 1) }),
    )
    expect(res.status).toBe(413)
  })

  it('rejects an over-limit File.size with 413 (valid Content-Length so the header gate does not fire vacuously)', async () => {
    const big = new File([new Uint8Array(MAX_ASSET_BYTES + 1)], 'photo.png', { type: 'image/png' })
    const res = await postTeamPhoto(uploadRequest({ file: big, contentLength: '1024' }))
    expect(res.status).toBe(413)
  })
})
