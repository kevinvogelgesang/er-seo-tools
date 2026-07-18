// @vitest-environment jsdom
//
// Viewbook UX pass, Lane 4 Task 3 — proves the RENDERER re-sanitizes on
// read. `lib/richtext/sanitize.ts` (Task 2) already sanitizes at write time,
// but this component must neutralize a tampered/legacy `html` prop even if
// something upstream forgot to (or a pre-sanitizer DB row reaches it) —
// defense in depth, not a duplicate of the write-time test.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { RichTextRenderer } from './RichTextRenderer'

describe('RichTextRenderer', () => {
  it('strips a script tag even though it arrives directly in the html prop', () => {
    const { container } = render(
      <RichTextRenderer html="<script>alert(1)</script><p>ok</p>" />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).not.toContain('alert(1)')
    const p = container.querySelector('p')
    expect(p).not.toBeNull()
    expect(p?.textContent).toBe('ok')
  })

  it('strips event-handler-bearing markup regardless of shape', () => {
    const { container } = render(
      <RichTextRenderer html={'<img src=x onerror="alert(1)"><p>safe</p>'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.textContent).toContain('safe')
  })

  it('renders every allowed tag straight through', () => {
    const html =
      '<h2>Title</h2><h3>Sub</h3><p>Body <strong>bold</strong> <em>italic</em> <u>under</u></p>' +
      '<ul><li>one</li></ul><ol><li>two</li></ol>'
    const { container } = render(<RichTextRenderer html={html} />)
    expect(container.querySelector('h2')?.textContent).toBe('Title')
    expect(container.querySelector('h3')?.textContent).toBe('Sub')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('u')?.textContent).toBe('under')
    expect(container.querySelectorAll('ul li')).toHaveLength(1)
    expect(container.querySelectorAll('ol li')).toHaveLength(1)
  })

  it('wraps output in the light-only .vb-richtext container', () => {
    const { container } = render(<RichTextRenderer html="<p>hi</p>" />)
    expect(container.querySelector('.vb-richtext')).not.toBeNull()
  })

  it('renders empty content for an empty string without throwing', () => {
    const { container } = render(<RichTextRenderer html="" />)
    const wrapper = container.querySelector('.vb-richtext')
    expect(wrapper).not.toBeNull()
    // Compare the sanitized-content child, not the whole wrapper — the
    // wrapper also carries a <style> tag whose text is part of
    // `.textContent` (style/script text nodes count, same as any element).
    expect(wrapper?.lastElementChild?.innerHTML).toBe('')
  })
})
