// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/components/footer', () => ({ default: () => <div data-testid="footer" /> }))
import PublicFooter from './PublicFooter'

afterEach(cleanup)

describe('PublicFooter gating', () => {
  it('suppresses the internal footer on the public viewbook page (anchored)', () => {
    pathname = '/viewbook/some-token'
    const { queryByTestId } = render(<PublicFooter />)
    expect(queryByTestId('footer')).toBeNull()
  })
  it('renders it elsewhere, including deeper viewbook-prefixed paths', () => {
    pathname = '/viewbook/some-token/deeper'
    const { queryByTestId } = render(<PublicFooter />)
    expect(queryByTestId('footer')).not.toBeNull()
    cleanup()
    pathname = '/about'
    const again = render(<PublicFooter />)
    expect(again.queryByTestId('footer')).not.toBeNull()
  })
})
