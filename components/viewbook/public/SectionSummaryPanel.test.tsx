// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionSummaryPanel, StatusPill } from './SectionSummaryPanel'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders a visible text label per status (never color-alone)', () => {
    const { container } = render(<StatusPill status="needs-input" />)
    expect(container.textContent).toContain('Needs input')
  })
})

describe('SectionSummaryPanel', () => {
  it('shows What this is', () => {
    const { container } = render(<SectionSummaryPanel whatThis="A living space." whatWeNeed={null} />)
    const text = container.textContent ?? ''
    expect(text).toContain('What this is')
    expect(text).toContain('A living space.')
  })

  it('shows What we need from you only when provided', () => {
    const withNeed = render(<SectionSummaryPanel whatThis="x" whatWeNeed="Do the thing." />)
    expect(withNeed.container.textContent).toContain('What we need from you')
    expect(withNeed.container.textContent).toContain('Do the thing.')
    cleanup()
    const without = render(<SectionSummaryPanel whatThis="x" whatWeNeed={null} />)
    expect(without.container.textContent).not.toContain('What we need from you')
  })
})
