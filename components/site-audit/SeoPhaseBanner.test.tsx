// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SeoPhaseBanner } from './SeoPhaseBanner'

afterEach(cleanup)

describe('SeoPhaseBanner', () => {
  it('running shows counts + refresh hint', () => {
    render(<SeoPhaseBanner phase={{ state: 'running', progress: 40, message: 'Checked 4/10 links' }} />)
    expect(screen.getByText(/SEO analysis running/i)).toBeTruthy()
    expect(screen.getByText(/Checked 4\/10 links/)).toBeTruthy()
    expect(screen.getByText(/refresh/i)).toBeTruthy()
  })
  it('queued', () => {
    render(<SeoPhaseBanner phase={{ state: 'queued', progress: null, message: null }} />)
    expect(screen.getByText(/SEO analysis queued/i)).toBeTruthy()
  })
  it('failed', () => {
    render(<SeoPhaseBanner phase={{ state: 'failed', progress: null, message: null }} />)
    expect(screen.getByText(/SEO analysis failed/i)).toBeTruthy()
  })
  it('unavailable', () => {
    render(<SeoPhaseBanner phase={{ state: 'unavailable', progress: null, message: null }} />)
    expect(screen.getByText(/not available/i)).toBeTruthy()
  })
  it('done renders nothing', () => {
    const { container } = render(<SeoPhaseBanner phase={{ state: 'done', progress: null, message: null }} />)
    expect(container.firstChild).toBeNull()
  })
})
