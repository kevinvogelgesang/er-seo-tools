// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PreviousStages } from './PreviousStages'
import type { PublicSection } from '@/lib/viewbook/public-types'

afterEach(cleanup)

const sec = (sectionKey: string, state: 'active' | 'done' = 'done') =>
  ({ sectionKey, state, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }) as PublicSection

describe('PreviousStages', () => {
  it('renders nothing for empty groups', () => {
    const { container } = render(<PreviousStages groups={[]} renderSection={() => null} />)
    expect(container.textContent).toBe('')
  })
  it('renders each stage label and calls renderSection with heroSize none', () => {
    const calls: { key: string; heroSize: string }[] = []
    const { container } = render(
      <PreviousStages
        groups={[{ stageLabel: 'Kickoff', sections: [sec('welcome')] }]}
        renderSection={(s, meta) => {
          calls.push({ key: s.sectionKey, heroSize: meta.heroSize })
          return <div data-testid={`body-${s.sectionKey}`}>body</div>
        }}
      />,
    )
    expect(container.textContent).toContain('Previous stages')
    expect(container.textContent).toContain('Kickoff')
    expect(container.querySelector('details')).toBeTruthy()
    expect(container.querySelector('[data-testid="body-welcome"]')).toBeTruthy()
    expect(calls).toEqual([{ key: 'welcome', heroSize: 'none' }])
  })
})
