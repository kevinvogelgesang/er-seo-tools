import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './transport'

const content = { subject: 'S', html: '<p>h</p>', text: 't' }

describe('sendEmail', () => {
  const OLD = process.env
  beforeEach(() => { process.env = { ...OLD, MAILGUN_API_KEY: 'key-abc', MAILGUN_DOMAIN: 'mg.example.com' } })
  afterEach(() => { process.env = OLD })

  it('POSTs form-encoded to the Mailgun messages endpoint with Basic auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"<1@mg>"}', { status: 200 }))
    await sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.mailgun.net/v3/mg.example.com/messages')
    expect((init as RequestInit).method).toBe('POST')
    const auth = (init as RequestInit).headers as Record<string, string>
    expect(auth.Authorization).toBe(`Basic ${Buffer.from('api:key-abc').toString('base64')}`)
    const body = (init as RequestInit).body as URLSearchParams
    expect(body.get('to')).toBe('r@example.com')
    expect(body.get('subject')).toBe('S')
  })

  it('throws on non-2xx and the error message never contains the API key', async () => {
    const fetchMock = vi.fn(async () => new Response('Forbidden: bad key key-abc', { status: 401 }))
    await expect(
      sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 }),
    ).rejects.toThrow()
    try {
      await sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 })
    } catch (e) {
      expect((e as Error).message).not.toContain('key-abc')
    }
  })

  it('throws when Mailgun config is absent (dark)', async () => {
    process.env = { ...OLD }
    delete process.env.MAILGUN_API_KEY
    const fetchMock = vi.fn()
    await expect(
      sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 }),
    ).rejects.toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
