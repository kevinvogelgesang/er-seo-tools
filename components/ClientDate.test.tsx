// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ClientDate } from './ClientDate'

describe('ClientDate', () => {
  it('renders em dash for null iso', () => {
    const { container } = render(<ClientDate iso={null} />)
    expect(container.textContent).toBe('—')
  })
  it('SSR output shows the ISO date slice (pre-mount fallback)', () => {
    const html = renderToString(<ClientDate iso="2026-05-13T19:15:00.000Z" />)
    expect(html).toContain('2026-05-13')
  })
})
