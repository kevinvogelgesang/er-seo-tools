// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntentChip } from './IntentChip'

afterEach(() => cleanup())

describe('IntentChip', () => {
  it('renders SEO for seoOnly', () => {
    render(<IntentChip seoOnly />)
    expect(screen.getByText('SEO')).toBeTruthy()
  })
  it('renders nothing for an ADA row (no noise)', () => {
    const { container } = render(<IntentChip seoOnly={false} />)
    expect(container.firstChild).toBeNull()
  })
})
