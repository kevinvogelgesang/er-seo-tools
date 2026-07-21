// @vitest-environment jsdom
// Lane D — StageOverview: the "In this stage" strip between the lead hero and
// the remaining chapters. DOM-native assertions only (this repo has NO
// jest-dom). navigateToAnchor is mocked so we can assert the click contract
// without touching real scroll/CustomEvent plumbing.
import { render, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'

const navigateSpy = vi.fn()
vi.mock('./viewbook-navigate', () => ({
  navigateToAnchor: (...args: unknown[]) => navigateSpy(...args),
}))

import { StageOverview } from './StageOverview'

afterEach(() => {
  cleanup()
  navigateSpy.mockClear()
})

const items = [
  { sectionKey: 'welcome', label: 'Welcome & Team', status: 'complete', anchor: '#welcome' },
  { sectionKey: 'milestones', label: 'Process & Milestones', status: 'current', anchor: '#milestones' },
] as any

describe('StageOverview', () => {
  it('renders a nav labeled "In this stage" with one entry per item', () => {
    const { container } = render(<StageOverview items={items} />)
    expect(container.querySelector('[aria-label="In this stage"]')).toBeTruthy()
    expect(container.querySelectorAll('button').length).toBe(2)
    const text = container.textContent ?? ''
    expect(text).toContain('Welcome & Team')
    expect(text).toContain('Process & Milestones')
  })

  it('shows a position number and a status label per entry', () => {
    const { container } = render(<StageOverview items={items} />)
    const text = container.textContent ?? ''
    expect(text).toContain('1')
    expect(text).toContain('2')
    expect(text.toLowerCase()).toContain('complete')
    expect(text.toLowerCase()).toContain('current')
  })

  it('navigates to the anchor on click', () => {
    const { container } = render(<StageOverview items={items} />)
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[1])
    expect(navigateSpy).toHaveBeenCalledWith('milestones', '#milestones')
  })

  it('renders nothing when there are no items', () => {
    const { container } = render(<StageOverview items={[]} />)
    expect(container.querySelector('nav')).toBeNull()
  })
})
