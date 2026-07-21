// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

const navigateSpy = vi.fn()
vi.mock('./viewbook-navigate', () => ({ navigateToAnchor: (k: string, a: string) => navigateSpy(k, a) }))

import { StageOverview } from './StageOverview'

afterEach(() => {
  cleanup()
  navigateSpy.mockReset()
})

const items = [
  { sectionKey: 'welcome' as const, label: 'Welcome & Team', status: 'complete' as const, anchor: '#welcome' },
  { sectionKey: 'milestones' as const, label: 'Milestones', status: 'current' as const, anchor: '#milestones' },
]

describe('StageOverview', () => {
  it('renders a nav with one button per item', () => {
    const { container } = render(<StageOverview items={items} />)
    expect(container.querySelector('nav[aria-label="In this stage"]')).toBeTruthy()
    expect(container.querySelectorAll('button').length).toBe(2)
    expect(container.textContent).toContain('Welcome & Team')
    expect(container.textContent).toContain('Milestones')
  })
  it('click navigates to the item anchor', () => {
    const { container } = render(<StageOverview items={items} />)
    fireEvent.click(container.querySelectorAll('button')[1])
    expect(navigateSpy).toHaveBeenCalledWith('milestones', '#milestones')
  })
  it('renders nothing for empty items', () => {
    const { container } = render(<StageOverview items={[]} />)
    expect(container.querySelector('nav')).toBeNull()
  })
})
