// components/widgets/WidgetFrame.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { WidgetFrame, WidgetErrorBoundary } from './WidgetFrame'

afterEach(cleanup)

describe('WidgetFrame', () => {
  it('renders its title and children', () => {
    render(<WidgetFrame title="Live now"><p>body</p></WidgetFrame>)
    expect(screen.getByText('Live now')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })
})

describe('WidgetErrorBoundary', () => {
  it('renders a degraded card when a child throws', () => {
    const Boom = () => { throw new Error('nope') }
    // Silence the expected React error log for this render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<WidgetErrorBoundary title="Recent parses"><Boom /></WidgetErrorBoundary>)
    expect(screen.getByText('Recent parses')).toBeTruthy()
    expect(screen.getByText(/couldn.t load/i)).toBeTruthy()
    spy.mockRestore()
  })
})
