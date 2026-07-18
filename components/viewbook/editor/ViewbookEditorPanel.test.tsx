// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewbookEditorPanel } from './ViewbookEditorPanel'

afterEach(cleanup)

describe('ViewbookEditorPanel', () => {
  it('defaults collapsed while keeping its children mounted in the DOM', () => {
    render(
      <ViewbookEditorPanel id="welcome-editor" title="Edit welcome note">
        <input aria-label="Welcome note" defaultValue="Hello" />
      </ViewbookEditorPanel>,
    )

    const trigger = screen.getByRole('button', { name: 'Edit welcome note' })
    const body = screen.getByRole('region', { hidden: true })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-controls')).toBe('welcome-editor-body')
    expect(body.id).toBe('welcome-editor-body')
    expect(body.hasAttribute('hidden')).toBe(true)
    expect(screen.getByLabelText('Welcome note')).toBeTruthy()
  })

  it('toggles its uncontrolled open state and renders header description and status', () => {
    render(
      <ViewbookEditorPanel
        title="Edit milestones"
        description="Update the client timeline"
        status={<span>Unsaved</span>}
      >
        <p>Milestone fields</p>
      </ViewbookEditorPanel>,
    )

    const trigger = screen.getByRole('button', { name: /Edit milestones/ })
    expect(screen.getByText('Update the client timeline')).toBeTruthy()
    expect(screen.getByText('Unsaved')).toBeTruthy()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region').hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('[data-viewbook-editor-panel-chevron]')?.getAttribute('class')).toContain('rotate-180')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Milestone fields')).toBeTruthy()
  })

  it('honors defaultOpen in uncontrolled mode', () => {
    render(
      <ViewbookEditorPanel title="Edit theme" defaultOpen>
        <p>Theme fields</p>
      </ViewbookEditorPanel>,
    )

    expect(screen.getByRole('button', { name: 'Edit theme' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region').hasAttribute('hidden')).toBe(false)
  })

  it('supports controlled open state without mutating it internally', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <ViewbookEditorPanel title="Edit data source" open={false} onOpenChange={onOpenChange}>
        <p>Data source fields</p>
      </ViewbookEditorPanel>,
    )

    const trigger = screen.getByRole('button', { name: 'Edit data source' })
    fireEvent.click(trigger)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    rerender(
      <ViewbookEditorPanel title="Edit data source" open onOpenChange={onOpenChange}>
        <p>Data source fields</p>
      </ViewbookEditorPanel>,
    )
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region').hasAttribute('hidden')).toBe(false)
  })
})
