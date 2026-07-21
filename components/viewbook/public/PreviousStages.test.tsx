// @vitest-environment jsdom
// Lane D — PreviousStages: replaces EarlierSteps. Carried sections grouped by
// origin stage. state==='collapsed' → a NON-expandable compact row (no toggle,
// renderSection NOT called); everything else → an expandable row that renders
// the section body via renderSection. DOM-native assertions only (no jest-dom).
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { PreviousStages } from './PreviousStages'

afterEach(() => {
  cleanup()
})

const sec = (sectionKey: string, state: 'active' | 'done' | 'collapsed'): PublicSection =>
  ({ sectionKey, state, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }) as PublicSection

describe('PreviousStages', () => {
  it('renders nothing when there are no groups', () => {
    const { container } = render(<PreviousStages groups={[]} renderSection={() => <div />} />)
    expect(container.textContent).toBe('')
  })

  it('renders a "Previous stages" heading and each origin-stage label', () => {
    const groups = [
      { stageLabel: 'Getting Started', sections: [sec('pc-setup', 'done')] },
      { stageLabel: 'Kickoff', sections: [sec('welcome', 'done')] },
    ]
    const { container } = render(
      <PreviousStages groups={groups} renderSection={(s) => <p>{s.sectionKey} body</p>} />,
    )
    const text = container.textContent ?? ''
    expect(text.toLowerCase()).toContain('previous stages')
    expect(text).toContain('Getting Started')
    expect(text).toContain('Kickoff')
  })

  it('expands non-collapsed carried sections via renderSection inside a toggle', () => {
    const rendered: string[] = []
    const groups = [{ stageLabel: 'Kickoff', sections: [sec('welcome', 'done')] }]
    const { container } = render(
      <PreviousStages
        groups={groups}
        renderSection={(s) => {
          rendered.push(s.sectionKey)
          return <p data-testid={`body-${s.sectionKey}`}>body</p>
        }}
      />,
    )
    expect(rendered).toContain('welcome')
    expect(container.querySelector('[data-testid="body-welcome"]')).toBeTruthy()
    expect(container.querySelector('details')).toBeTruthy()
  })

  it('renders a collapsed carried section as a non-expandable compact row', () => {
    const rendered: string[] = []
    const groups = [{ stageLabel: 'Kickoff', sections: [sec('welcome', 'collapsed')] }]
    const { container } = render(
      <PreviousStages
        groups={groups}
        renderSection={(s) => {
          rendered.push(s.sectionKey)
          return <p>body</p>
        }}
      />,
    )
    // collapsed → no body rendered, no toggle
    expect(rendered).not.toContain('welcome')
    expect(container.querySelector('details')).toBeNull()
    // ...but the section is still named so the reader knows it exists
    expect(container.textContent).toContain('Welcome & Team')
  })

  it('mixes compact and expandable rows within one group', () => {
    const rendered: string[] = []
    const groups = [
      { stageLabel: 'Kickoff', sections: [sec('welcome', 'collapsed'), sec('milestones', 'done')] },
    ]
    const { container } = render(
      <PreviousStages
        groups={groups}
        renderSection={(s) => {
          rendered.push(s.sectionKey)
          return <p data-testid={`body-${s.sectionKey}`}>body</p>
        }}
      />,
    )
    expect(rendered).toEqual(['milestones'])
    expect(container.querySelector('[data-testid="body-milestones"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="body-welcome"]')).toBeNull()
    expect(container.textContent).toContain('Welcome & Team')
    expect(container.textContent).toContain('Process & Milestones')
  })
})
