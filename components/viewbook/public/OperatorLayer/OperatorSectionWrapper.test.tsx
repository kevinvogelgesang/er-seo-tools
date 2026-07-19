// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OperatorSectionWrapper } from './OperatorSectionWrapper'

afterEach(cleanup)

describe('OperatorSectionWrapper', () => {
  it('is boundary-only: renders the real section + a scroll-spy target, NO controls or editors', () => {
    const { container } = render(
      <OperatorSectionWrapper sectionKey="welcome">
        <div>Real public section</div>
      </OperatorSectionWrapper>,
    )
    expect(screen.getByText('Real public section')).toBeTruthy()
    // Scroll-spy target boundary (useSectionSelection reads [data-operator-section]).
    expect(container.querySelector('[data-operator-section="welcome"]')).toBeTruthy()
    // PR4: the status controls moved into the inspector pane's Status group.
    expect(container.querySelector('[data-operator-section-controls]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    // Inline editors moved to InspectorPanes — no editor chrome below the section.
    expect(container.querySelector('[data-operator-inline-editor]')).toBeNull()
    expect(container.querySelector('[data-operator-section-wrapper]')?.getAttribute('class')).toBeNull()
  })

  it('renders children only when told the viewer is not an operator', () => {
    const { container } = render(
      <OperatorSectionWrapper sectionKey="welcome" isOperator={false}>
        <div>Anonymous section</div>
      </OperatorSectionWrapper>,
    )
    expect(screen.getByText('Anonymous section')).toBeTruthy()
    expect(container.querySelector('[data-operator-section-wrapper]')).toBeNull()
    expect(container.querySelector('[data-operator-section-controls]')).toBeNull()
  })
})
