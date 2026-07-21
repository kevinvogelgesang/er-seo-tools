// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'

afterEach(cleanup)

const baseSection = {
  sectionKey: 'brand', state: 'active', doneAt: null, acknowledgedAt: null,
  introNote: null, narrative: null,
} as any
const copy = { purpose: 'Your brand.', whatThis: 'The logos and colors.', whatWeNeed: 'Share brand rules.' }
const meta = { heroSize: 'full', chapterNumber: 3, status: 'current', isLead: false } as any

function renderShell(viewerMode: 'continuous' | 'collapse') {
  return render(
    <SectionShell
      section={baseSection} title="Brand" heroUrl={null} stage="building"
      affordance="chevron" overlayStrength={55} isOperator={false} viewbookId={1} token="t"
      meta={meta} viewerMode={viewerMode} sectionCopy={copy}
    >
      <div>body</div>
    </SectionShell>
  )
}

describe('SectionShell section-copy tooltip', () => {
  it('continuous: renders an info-tooltip carrying whatThis + whatWeNeed, and NO summary panel', () => {
    const { container } = renderShell('continuous') // renderShell already calls render()
    expect(container.querySelector('[data-vb-summary-panel]')).toBeNull()
    const tip = container.querySelector('[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(tip!.textContent).toContain('The logos and colors.')
    expect(tip!.textContent).toContain('Share brand rules.')
  })

  it('the tooltip trigger is NOT nested inside the h2 (accessible-name safety)', () => {
    const { container } = renderShell('continuous')
    const h2 = container.querySelector('h2')
    expect(h2).not.toBeNull()
    expect(h2!.querySelector('[aria-describedby]')).toBeNull()
  })
})
