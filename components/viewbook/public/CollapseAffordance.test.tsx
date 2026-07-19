// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CollapseAffordance } from './CollapseAffordance'

afterEach(cleanup)

describe('CollapseAffordance', () => {
  it.each(['bar', 'pill', 'chevron'] as const)(
    '%s renders a button with the accessible name + aria-controls',
    (kind) => {
      render(
        <CollapseAffordance
          kind={kind}
          regionId="r1"
          accessibleName="Expand (just for you)"
          onExpand={() => {}}
          disabled={false}
        />,
      )
      const btn = screen.getByRole('button', { name: 'Expand (just for you)' })
      expect(btn.getAttribute('aria-controls')).toBe('r1')
      expect(btn.getAttribute('aria-expanded')).toBe('false')
    },
  )

  it('bar and pill show a visible label; chevron is icon-only with aria-label', () => {
    const { unmount: unmountBar } = render(
      <CollapseAffordance kind="bar" regionId="r1" accessibleName="Expand for everyone" onExpand={() => {}} disabled={false} />,
    )
    expect(screen.getByText('Expand for everyone')).toBeDefined()
    unmountBar()

    const { unmount: unmountPill } = render(
      <CollapseAffordance kind="pill" regionId="r1" accessibleName="Expand for everyone" onExpand={() => {}} disabled={false} />,
    )
    expect(screen.getByText('Expand for everyone')).toBeDefined()
    unmountPill()

    render(
      <CollapseAffordance kind="chevron" regionId="r1" accessibleName="Expand for everyone" onExpand={() => {}} disabled={false} />,
    )
    // No visible text node for the label — only the aria-label carries it.
    expect(screen.queryByText('Expand for everyone')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand for everyone' })).toBeDefined()
  })

  it('disabled prevents onExpand', () => {
    const onExpand = vi.fn()
    render(
      <CollapseAffordance kind="bar" regionId="r1" accessibleName="Expand" onExpand={onExpand} disabled />,
    )
    const btn = screen.getByRole('button', { name: 'Expand' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onExpand).not.toHaveBeenCalled()
  })
})
