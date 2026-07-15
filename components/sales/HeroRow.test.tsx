// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HeroRow } from './HeroRow'

afterEach(cleanup)
window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never

describe('HeroRow', () => {
  it('renders the screenshot card with the token-scoped hero URL when heroScreenshot=true', () => {
    render(<HeroRow token="tok1" auditId="aud1" domain="acme.test" overallScore={53} heroScreenshot={true} />)
    const img = screen.getByRole('img', { name: /homepage of acme.test/i }) as HTMLImageElement
    expect(img.src).toContain('/api/sales/tok1/hero/aud1')
    expect(screen.getByText('53')).toBeTruthy()
  })
  it('hides the slot (no placeholder) when heroScreenshot=false', () => {
    render(<HeroRow token="tok1" auditId="aud1" domain="acme.test" overallScore={53} heroScreenshot={false} />)
    expect(screen.queryByRole('img', { name: /homepage of/i })).toBeNull()
    expect(screen.getByText('53')).toBeTruthy() // gauge still renders, full width
  })
})
