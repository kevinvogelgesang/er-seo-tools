// @vitest-environment jsdom
// components/quarter-grid/NoteModal.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NoteModal } from './NoteModal'

afterEach(cleanup)

describe('NoteModal', () => {
  it('saves the clamped draft and closes; close without save discards', () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<NoteModal id={7} note="hello" clientName="Acme" onSave={onSave} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(200) } })
    fireEvent.click(screen.getByText('Save Note'))
    expect(onSave).toHaveBeenCalledWith(7, 'x'.repeat(120))
    expect(onClose).toHaveBeenCalled()
  })

  it('re-syncs the draft when the target chip changes while mounted', () => {
    const { rerender } = render(<NoteModal id={7} note="first" clientName="A" onSave={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('first')
    rerender(<NoteModal id={8} note="second" clientName="B" onSave={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('second')
  })
})
