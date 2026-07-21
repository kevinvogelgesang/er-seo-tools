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

  it('renders a ReactNode label and wires aria-describedby to the tooltip id', () => {
    const { container } = render(
      <Tooltip id="tip-1" label={<div><p>What this is</p><p>Detail</p></div>} />
    )
    const trigger = container.querySelector('[aria-describedby="tip-1"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute('tabindex')).toBe('0')
    const tip = container.querySelector('#tip-1[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(tip!.textContent).toContain('What this is')
    expect(tip!.textContent).toContain('Detail')
  })

  it('on-primary tone renders the default glyph in white', () => {
    const { container } = render(<Tooltip id="tip-2" label="x" tone="on-primary" />)
    const trigger = container.querySelector('[aria-describedby="tip-2"]')!
    expect(trigger.className).toContain('text-white')
  })
})
