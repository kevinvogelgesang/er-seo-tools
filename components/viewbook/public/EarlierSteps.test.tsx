// @vitest-environment jsdom
// Regression coverage for the review finding: the DotStack accent (Task 10)
// must render as a descendant of <summary>, never as a direct non-<summary>
// child of <details>. The browser UA stylesheet hides every direct child of
// <details> except <summary> until [open] (`details > *:not(summary) {
// display: none }`, matched by element TYPE not position) — an accent placed
// there is invisible in the default COLLAPSED state it exists to decorate.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { EarlierSteps } from './EarlierSteps'

afterEach(() => {
  cleanup()
})

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey,
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
})

describe('EarlierSteps', () => {
  it('renders the DotStack accent inside <summary>, not as a direct non-summary child of <details>', () => {
    const { container } = render(
      <EarlierSteps
        sections={[sec('brand'), sec('strategy')]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    // The accent must be reachable inside <summary> — this is what keeps it
    // visible while the outer <details> is collapsed (the default state).
    const accentInSummary = container.querySelector('summary svg[aria-hidden]')
    expect(accentInSummary).not.toBeNull()

    // No <svg> may be a direct child of a <details> element outside its
    // <summary> — that's exactly the position the UA stylesheet hides.
    const details = container.querySelectorAll('details')
    expect(details.length).toBeGreaterThan(0)
    for (const d of Array.from(details)) {
      for (const child of Array.from(d.children)) {
        if (child.tagName.toLowerCase() === 'svg') {
          throw new Error('Found an <svg> as a direct child of <details> outside <summary>')
        }
      }
    }
  })

  it('renders nothing when there are no carried sections', () => {
    const { container } = render(<EarlierSteps sections={[]} renderSection={() => null} />)
    expect(container.querySelector('details')).toBeNull()
  })
})
