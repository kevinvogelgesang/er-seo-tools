// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { StatusPill } from './StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders a visible text label per status (never color-alone)', () => {
    const { container } = render(<StatusPill status="needs-input" />)
    expect(container.textContent).toContain('Needs input')
    expect(container.querySelector('[data-vb-status-pill="needs-input"]')).not.toBeNull()
  })
})
