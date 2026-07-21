// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom (Global Constraints).
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SectionSummaryPanel } from './SectionSummaryPanel'

describe('SectionSummaryPanel', () => {
  it('shows What this is and the status label', () => {
    const { container } = render(<SectionSummaryPanel whatThis="A living space." whatWeNeed={null} status="current" />)
    const text = container.textContent ?? ''
    expect(text).toContain('What this is')
    expect(text).toContain('A living space.')
    expect(text.toLowerCase()).toContain('current')
  })
  it('shows What we need from you only when provided', () => {
    const withNeed = render(<SectionSummaryPanel whatThis="x" whatWeNeed="Do the thing." status="needs-input" />)
    expect(withNeed.container.textContent).toContain('What we need from you')
    expect(withNeed.container.textContent).toContain('Do the thing.')
    const without = render(<SectionSummaryPanel whatThis="x" whatWeNeed={null} status="complete" />)
    expect(without.container.textContent).not.toContain('What we need from you')
  })
})
