// @vitest-environment jsdom
// components/ui/SeverityBadge.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SeverityBadge } from './SeverityBadge'

describe('SeverityBadge', () => {
  it('renders the label', () => {
    render(<SeverityBadge label="critical" tone="red" />)
    expect(screen.getByText('critical')).toBeTruthy()
  })

  it.each([
    ['red', 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'],
    ['orange', 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400'],
    ['amber', 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'],
    ['blue', 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'],
    ['purple', 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400'],
    ['gray', 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'],
  ] as const)('tone %s maps to its documented classes', (tone, classes) => {
    render(<SeverityBadge label={tone} tone={tone} />)
    const el = screen.getByText(tone)
    for (const c of classes.split(' ')) expect(el.className).toContain(c)
  })

  it('applies the compact badge shape incl. shrink-0', () => {
    render(<SeverityBadge label="shape" tone="gray" />)
    const el = screen.getByText('shape')
    for (const c of ['inline-flex', 'shrink-0', 'items-center', 'rounded', 'px-1.5', 'py-0.5', 'text-[10px]', 'font-body', 'font-semibold']) {
      expect(el.className).toContain(c)
    }
    expect(el.className).not.toContain('uppercase')
  })

  it('supports uppercase and title passthrough', () => {
    render(<SeverityBadge label="drop" tone="amber" uppercase title="score dropped 12" />)
    const el = screen.getByText('drop')
    expect(el.className).toContain('uppercase')
    expect(el.getAttribute('title')).toBe('score dropped 12')
  })
})
