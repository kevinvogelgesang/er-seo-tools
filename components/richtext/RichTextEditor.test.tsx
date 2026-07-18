// @vitest-environment jsdom
//
// Viewbook UX pass, Lane 4 Task 3 — the reusable WYSIWYG editor.
//
// jsdom does NOT implement `document.execCommand` at all (not even a no-op
// stub — calling it throws `TypeError: ... is not a function`). Real
// browsers all support it (deprecated but universal), so production code
// calls it directly; here we stub it per-test so (a) the component doesn't
// throw and (b) we can assert exactly what command/value the toolbar wired
// up, which is the jsdom-testable subset the task brief calls for — we do
// NOT assert that jsdom actually mutates the DOM into a <b>/<h2>/etc, since
// jsdom has no rich-text-editing engine behind execCommand to do that.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RichTextEditor } from './RichTextEditor'

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(document as any).execCommand = vi.fn()
})

afterEach(() => {
  cleanup()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (document as any).execCommand
})

describe('RichTextEditor', () => {
  // codex-review P1: force tag-based <b>/<i>/<u> (not <span style>, which
  // the strict sanitizer would discard) and <p> paragraphs (not the bare
  // <div> Enter creates) at editor init — belt-and-suspenders with
  // sanitize.ts's transformTags.
  it('initializes styleWithCSS(false) and defaultParagraphSeparator(p) on mount', () => {
    render(<RichTextEditor value="<p>x</p>" onChange={vi.fn()} ariaLabel="Notes" />)
    expect(document.execCommand).toHaveBeenCalledWith('styleWithCSS', false, false)
    expect(document.execCommand).toHaveBeenCalledWith('defaultParagraphSeparator', false, 'p')
  })

  it('renders a labeled toolbar and an aria-labeled contentEditable region', () => {
    render(<RichTextEditor value="<p>hi</p>" onChange={vi.fn()} ariaLabel="Assessment notes" />)
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).not.toBeNull()
    const editable = screen.getByRole('textbox', { name: 'Assessment notes' })
    expect(editable.getAttribute('contenteditable')).toBe('true')
    // Every documented action is present.
    for (const name of ['Heading 2', 'Heading 3', 'Bold', 'Italic', 'Underline', 'Bullet list', 'Numbered list']) {
      expect(screen.getByRole('button', { name })).not.toBeNull()
    }
  })

  it('seeds the editable region from the value prop on mount', () => {
    render(<RichTextEditor value="<p>seed</p>" onChange={vi.fn()} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })
    expect(editable.innerHTML).toBe('<p>seed</p>')
  })

  it('does not clobber live content when the parent echoes back the last emitted value', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RichTextEditor value="<p>seed</p>" onChange={onChange} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })

    // Simulate typing: mutate the live DOM directly (as a real keystroke
    // would) and fire input, exactly like the user editing in place.
    editable.innerHTML = '<p>seed more</p>'
    fireEvent.input(editable)
    expect(onChange).toHaveBeenCalledWith('<p>seed more</p>')

    // Parent re-renders with the SAME value it was just handed via
    // onChange — this must NOT reset the live DOM out from under the user.
    rerender(<RichTextEditor value="<p>seed more</p>" onChange={onChange} ariaLabel="Notes" />)
    expect(editable.innerHTML).toBe('<p>seed more</p>')
  })

  it('reconciles the live DOM when value changes externally (not an echo of the last onChange)', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RichTextEditor value="<p>seed</p>" onChange={onChange} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })

    // An external reset (e.g. a different editor session's save landing) —
    // never echoed through this editor's own onChange — must win.
    rerender(<RichTextEditor value="<p>replaced</p>" onChange={onChange} ariaLabel="Notes" />)
    expect(editable.innerHTML).toBe('<p>replaced</p>')
  })

  it('fires onChange with the current HTML when the region receives input', () => {
    const onChange = vi.fn()
    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })
    editable.innerHTML = '<p>typed</p>'
    fireEvent.input(editable)
    expect(onChange).toHaveBeenCalledWith('<p>typed</p>')
  })

  it('wires the Bold button to execCommand("bold") and fires onChange', async () => {
    const onChange = vi.fn()
    render(<RichTextEditor value="<p>x</p>" onChange={onChange} ariaLabel="Notes" />)
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined)
    expect(onChange).toHaveBeenCalled()
  })

  it('wires the Heading 2 button to execCommand("formatBlock", false, "h2")', async () => {
    render(<RichTextEditor value="<p>x</p>" onChange={vi.fn()} ariaLabel="Notes" />)
    await userEvent.click(screen.getByRole('button', { name: 'Heading 2' }))
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2')
  })

  it('wires the Bullet list button to execCommand("insertUnorderedList")', async () => {
    render(<RichTextEditor value="<p>x</p>" onChange={vi.fn()} ariaLabel="Notes" />)
    await userEvent.click(screen.getByRole('button', { name: 'Bullet list' }))
    expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList', false, undefined)
  })

  it('prevents default on mousedown for toolbar buttons so selection is not lost', () => {
    render(<RichTextEditor value="<p>x</p>" onChange={vi.fn()} ariaLabel="Notes" />)
    const button = screen.getByRole('button', { name: 'Bold' })
    const event = fireEvent.mouseDown(button)
    // fireEvent returns `false` when the event's preventDefault() was called
    // (the return value of dispatchEvent, which is false exactly when the
    // event was cancelable and canceled).
    expect(event).toBe(false)
  })

  it('intercepts paste and inserts PLAIN TEXT ONLY, never the clipboard HTML', () => {
    const onChange = vi.fn()
    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })

    const getData = vi.fn((type: string) => (type === 'text/plain' ? 'plain text' : '<b onclick="evil()">rich</b>'))
    const pasteReturn = fireEvent.paste(editable, { clipboardData: { getData } })

    expect(pasteReturn).toBe(false) // preventDefault() was called
    expect(getData).toHaveBeenCalledWith('text/plain')
    expect(getData).not.toHaveBeenCalledWith('text/html')
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'plain text')
    expect(onChange).toHaveBeenCalled()
  })

  it('intercepts drop and inserts PLAIN TEXT ONLY, never the drag payload HTML', () => {
    const onChange = vi.fn()
    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Notes" />)
    const editable = screen.getByRole('textbox', { name: 'Notes' })

    const getData = vi.fn((type: string) => (type === 'text/plain' ? 'dropped text' : '<img src=x onerror=evil()>'))
    const dropReturn = fireEvent.drop(editable, { dataTransfer: { getData } })

    expect(dropReturn).toBe(false)
    expect(getData).toHaveBeenCalledWith('text/plain')
    expect(getData).not.toHaveBeenCalledWith('text/html')
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'dropped text')
    expect(onChange).toHaveBeenCalled()
  })
})
