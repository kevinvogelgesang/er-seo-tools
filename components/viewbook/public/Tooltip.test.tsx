// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('renders the label in a tooltip role wired to a focusable default trigger', () => {
    render(<Tooltip id="tt-lab" label="Lab data explainer" />)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Lab data explainer')
    expect(tip.getAttribute('id')).toBe('tt-lab')
    const trigger = screen.getByText('ⓘ')
    expect(trigger.getAttribute('tabindex')).toBe('0')
    expect(trigger.getAttribute('aria-describedby')).toBe('tt-lab')
  })

  it('wraps provided children in a focusable described-by trigger', () => {
    render(<Tooltip id="tt-m" label="hint"><span>metric</span></Tooltip>)
    expect(screen.queryByText('ⓘ')).toBeNull()
    const wrapper = screen.getByText('metric').closest('[aria-describedby="tt-m"]')!
    expect(wrapper).not.toBeNull()
    expect(wrapper.getAttribute('tabindex')).toBe('0')
  })
})
