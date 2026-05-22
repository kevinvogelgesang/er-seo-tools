import { describe, expect, it, vi } from 'vitest'
import type { GoToOptions, HTTPResponse, Page } from 'puppeteer-core'
import { TimeoutError } from 'puppeteer-core'
import { gotoWithRetryOn5xx, postLoadSettle } from './page-load'

function stubResponse(status: number): HTTPResponse {
  return { status: () => status } as unknown as HTTPResponse
}

function stubPage(responses: Array<HTTPResponse | null | Error>): {
  page: Pick<Page, 'goto'>
  calls: () => number
} {
  let i = 0
  const goto = vi.fn(async () => {
    const next = responses[i++]
    if (next instanceof Error) throw next
    return next
  })
  return { page: { goto: goto as unknown as Page['goto'] }, calls: () => goto.mock.calls.length }
}

const OPTS: GoToOptions = { waitUntil: 'networkidle2', timeout: 30_000 }

describe('gotoWithRetryOn5xx', () => {
  it('returns the second response when first is 503 and second is 200', async () => {
    const { page, calls } = stubPage([stubResponse(503), stubResponse(200)])
    const onRetry = vi.fn()

    const res = await gotoWithRetryOn5xx(page, 'https://example.test', OPTS, onRetry)

    expect(res?.status()).toBe(200)
    expect(calls()).toBe(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries once and surfaces the second 5xx response (no third attempt)', async () => {
    const { page, calls } = stubPage([stubResponse(503), stubResponse(503)])

    const res = await gotoWithRetryOn5xx(page, 'https://example.test', OPTS)

    expect(res?.status()).toBe(503)
    expect(calls()).toBe(2)
  })

  it('does not retry on 4xx', async () => {
    const { page, calls } = stubPage([stubResponse(404)])
    const onRetry = vi.fn()

    const res = await gotoWithRetryOn5xx(page, 'https://example.test', OPTS, onRetry)

    expect(res?.status()).toBe(404)
    expect(calls()).toBe(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('does not retry on 2xx', async () => {
    const { page, calls } = stubPage([stubResponse(200)])

    const res = await gotoWithRetryOn5xx(page, 'https://example.test', OPTS)

    expect(res?.status()).toBe(200)
    expect(calls()).toBe(1)
  })

  it('does not retry when goto throws (timeout / DNS / SSRF block)', async () => {
    const boom = new Error('Navigation timeout of 30000 ms exceeded')
    const { page, calls } = stubPage([boom])
    const onRetry = vi.fn()

    await expect(
      gotoWithRetryOn5xx(page, 'https://example.test', OPTS, onRetry),
    ).rejects.toThrow(/Navigation timeout/)
    expect(calls()).toBe(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('does not retry when goto returns null', async () => {
    const { page, calls } = stubPage([null])

    const res = await gotoWithRetryOn5xx(page, 'https://example.test', OPTS)

    expect(res).toBeNull()
    expect(calls()).toBe(1)
  })

  it('retries on 500 and on 599 (whole 5xx range)', async () => {
    const a = stubPage([stubResponse(500), stubResponse(200)])
    const b = stubPage([stubResponse(599), stubResponse(200)])

    await gotoWithRetryOn5xx(a.page, 'https://example.test', OPTS)
    await gotoWithRetryOn5xx(b.page, 'https://example.test', OPTS)

    expect(a.calls()).toBe(2)
    expect(b.calls()).toBe(2)
  })
})

describe('postLoadSettle', () => {
  it('resolves normally when waitForNetworkIdle resolves', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockResolvedValue(undefined) }
    await expect(postLoadSettle(fakePage as never)).resolves.toBeUndefined()
    expect(fakePage.waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 500, timeout: 5_000 })
  })

  it('swallows ONLY the TimeoutError from waitForNetworkIdle', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new TimeoutError('timed out')) }
    await expect(postLoadSettle(fakePage as never)).resolves.toBeUndefined()
  })

  it('rethrows non-timeout failures (e.g. frame detach during settle)', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new Error('Navigating frame was detached')) }
    await expect(postLoadSettle(fakePage as never)).rejects.toThrow('Navigating frame was detached')
  })

  it('rethrows unknown errors so the transient-retry layer can see them', async () => {
    class WeirdError extends Error {}
    const fakePage = { waitForNetworkIdle: vi.fn().mockRejectedValue(new WeirdError('boom')) }
    await expect(postLoadSettle(fakePage as never)).rejects.toThrow('boom')
  })

  it('honors a caller-supplied timeout', async () => {
    const fakePage = { waitForNetworkIdle: vi.fn().mockResolvedValue(undefined) }
    await postLoadSettle(fakePage as never, { timeout: 2_000 })
    expect(fakePage.waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 500, timeout: 2_000 })
  })
})
