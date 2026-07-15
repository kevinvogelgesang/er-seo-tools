// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SalesReportHeader } from './SalesReportHeader'

afterEach(cleanup)

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as never
}

describe('SalesReportHeader', () => {
  it('renders logo, title, prepared-for line, and the Book a review CTA', () => {
    stubMatchMedia(false)
    render(<SalesReportHeader prospectName="Acme College" domain="acme.test" preparedBy="Kevin" />)
    expect(screen.getByAltText(/enrollment resources/i)).toBeTruthy()
    expect(screen.getByText('Website Audit Report')).toBeTruthy()
    expect(screen.getByText(/prepared for acme college/i)).toBeTruthy()
    expect(screen.getByText(/by kevin @ enrollment resources/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /book a review/i })).toBeTruthy()
  })

  it('null preparedBy → just "By Enrollment Resources"', () => {
    stubMatchMedia(false)
    render(<SalesReportHeader prospectName="Acme" domain="acme.test" preparedBy={null} />)
    expect(screen.getByText(/by enrollment resources/i)).toBeTruthy()
    expect(screen.queryByText(/@ enrollment resources/i)).toBeNull()
  })

  it('CTA scrolls to #inquiry, honoring prefers-reduced-motion via matchMedia', () => {
    stubMatchMedia(true)
    const target = document.createElement('div')
    target.id = 'inquiry'
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    render(<SalesReportHeader prospectName="A" domain="a.test" preparedBy={null} />)
    fireEvent.click(screen.getByRole('button', { name: /book a review/i }))
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    target.remove()
  })
})
