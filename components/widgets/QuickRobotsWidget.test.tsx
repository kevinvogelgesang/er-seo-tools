// components/widgets/QuickRobotsWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickRobotsWidget } from './QuickRobotsWidget'

afterEach(() => { cleanup(); pushMock.mockReset() })

describe('QuickRobotsWidget', () => {
  it('redirects to the validator with the encoded url', () => {
    render(<QuickRobotsWidget size="sm" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'https://a.com' } })
    fireEvent.click(screen.getByRole('button', { name: /check/i }))
    expect(pushMock).toHaveBeenCalledWith('/robots-validator?url=' + encodeURIComponent('https://a.com'))
  })

  it('does nothing on an empty url', () => {
    render(<QuickRobotsWidget size="sm" />)
    fireEvent.click(screen.getByRole('button', { name: /check/i }))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
