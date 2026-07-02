// lib/ops/alert-webhook.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendAlert } from './alert-webhook'

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('sendAlert', () => {
  it('URL unset → skipped, no fetch', async () => {
    vi.unstubAllEnvs()
    delete process.env.ALERT_WEBHOOK_URL
    const f = vi.spyOn(globalThis, 'fetch')
    expect(await sendAlert('hi')).toEqual({ sent: false, skipped: true })
    expect(f).not.toHaveBeenCalled()
  })
  it('URL set + 2xx → sent, one POST with {text}', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/x')
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    expect(await sendAlert('boom')).toEqual({ sent: true, skipped: false })
    expect(f).toHaveBeenCalledOnce()
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ text: 'boom' })
  })
  it('fetch rejection is swallowed → not sent, not skipped', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/x')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect(await sendAlert('boom')).toEqual({ sent: false, skipped: false })
  })
})
