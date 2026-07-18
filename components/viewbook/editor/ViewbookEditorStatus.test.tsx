// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ViewbookEditorStatus } from './ViewbookEditorStatus'

afterEach(cleanup)

describe('ViewbookEditorStatus', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<ViewbookEditorStatus state="idle" />)
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['dirty', 'Unsaved'],
    ['saving', 'Saving…'],
    ['saved', 'Saved'],
  ] as const)('renders the %s state as %s', (state, label) => {
    render(<ViewbookEditorStatus state={state} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('renders a semantic conflict pill with a custom message', () => {
    render(<ViewbookEditorStatus state="conflict" message="A newer answer exists" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('A newer answer exists')
    expect(status.getAttribute('class')).toContain('dark:bg-amber-500/15')
  })

  it('renders a semantic error pill as an alert with a custom message', () => {
    render(<ViewbookEditorStatus state="error" message="Save failed" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Save failed')
    expect(alert.getAttribute('class')).toContain('dark:bg-red-500/15')
  })
})
