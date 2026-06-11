// @vitest-environment jsdom
// components/quarter-grid/PushToTeamworkButton.test.tsx
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PushToTeamworkButton } from './PushToTeamworkButton'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

function stub(status: number, json: unknown = {}) {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => json }) as Response))
  return { writeText }
}

describe('PushToTeamworkButton', () => {
  it('mints, composes the qct_ payload, and copies it', async () => {
    const { writeText } = stub(200, { token: 'qct_abc', expiresAt: 'x', planId: 7 })
    render(<PushToTeamworkButton />)
    fireEvent.click(screen.getByText('⇪ Push to Teamwork'))
    await flush()
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0][0] as unknown as string
    expect(payload).toContain('Push the current quarter cycle to Teamwork.')
    expect(payload).toContain('Plan ID: 7')
    expect(payload).toContain('Access token: qct_abc')
    expect(screen.getByText('Copied!')).toBeTruthy()
  })

  it('shows "Nothing to push" on 409', async () => {
    stub(409, { error: 'nothing_planned' })
    render(<PushToTeamworkButton />)
    fireEvent.click(screen.getByText('⇪ Push to Teamwork'))
    await flush()
    expect(screen.getByText('Nothing to push')).toBeTruthy()
  })

  it('shows retry label on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    render(<PushToTeamworkButton />)
    fireEvent.click(screen.getByText('⇪ Push to Teamwork'))
    await flush()
    expect(screen.getByText('Failed — retry')).toBeTruthy()
  })
})
