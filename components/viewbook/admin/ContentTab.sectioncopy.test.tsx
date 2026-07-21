// @vitest-environment jsdom
//
// Task 11: per-viewbook section-copy overrides (the ⓘ tooltip copy —
// purpose/whatThis/whatWeNeed — resolved code default ← company-wide ←
// per-viewbook). Renders the exported SectionCopyOverrides directly (props
// come from ViewbookDetail.sectionCopy). DOM-native assertions, no jest-dom.
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { SectionCopyOverrides } from './ContentTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => vi.restoreAllMocks())

describe('SectionCopyOverrides', () => {
  it('PUTs a per-viewbook section-copy override to the per-viewbook endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <SectionCopyOverrides
        viewbookId={7}
        sectionKeys={['brand'] as const}
        resolved={{ brand: { purpose: 'P', whatThis: 'T', whatWeNeed: null } } as never}
      />,
    )
    fireEvent.change(screen.getByLabelText('What this is — brand'), { target: { value: 'Client-specific' } })
    fireEvent.click(screen.getByRole('button', { name: /save brand override/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/viewbooks/7/section-copy/brand')
    expect((opts as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({
      purpose: 'P',
      whatThis: 'Client-specific',
      whatWeNeed: null,
    })
  })

  it('DELETEs the same endpoint when Clear override is clicked', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <SectionCopyOverrides
        viewbookId={7}
        sectionKeys={['brand'] as const}
        resolved={{ brand: { purpose: 'P', whatThis: 'T', whatWeNeed: null } } as never}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /clear brand override/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/viewbooks/7/section-copy/brand',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  // Review fix: SectionCopyOverrideRow used to seed plain useState from
  // `resolved` ONCE — ViewbookEditor re-renders ContentTab with fresh
  // `resolved` props on every syncVersion poll WITHOUT remounting (stable
  // `key={sectionKey}`), so a later prop change (e.g. the resolved fallback
  // after Clear override) never reached the fields. Now wired through
  // useBaselineSync: while the row is idle (not focused, not saving) a
  // changed `resolved` prop must be adopted, proving the stale-display bug
  // is fixed.
  it('adopts a changed resolved value while idle (reconcile after Clear/reload)', async () => {
    const { rerender } = render(
      <SectionCopyOverrides
        viewbookId={7}
        sectionKeys={['brand'] as const}
        resolved={{ brand: { purpose: 'P', whatThis: 'T', whatWeNeed: null } } as never}
      />,
    )
    expect((screen.getByLabelText('What this is — brand') as HTMLTextAreaElement).value).toBe('T')
    expect((screen.getByLabelText('Chapter one-liner — brand') as HTMLTextAreaElement).value).toBe('P')

    // Parent reload delivers a fresh `resolved` (e.g. the company-wide/code
    // default fallback after a Clear) WITHOUT remounting this row.
    rerender(
      <SectionCopyOverrides
        viewbookId={7}
        sectionKeys={['brand'] as const}
        resolved={{ brand: { purpose: 'P2', whatThis: 'Default company copy', whatWeNeed: null } } as never}
      />,
    )

    await waitFor(() =>
      expect((screen.getByLabelText('What this is — brand') as HTMLTextAreaElement).value).toBe(
        'Default company copy',
      ),
    )
    expect((screen.getByLabelText('Chapter one-liner — brand') as HTMLTextAreaElement).value).toBe('P2')
  })
})
