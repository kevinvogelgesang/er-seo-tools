// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import type { TeamMember } from '@/lib/viewbook/global-content-keys'
import { ProgressNav } from './ProgressNav'

afterEach(cleanup)

const team: TeamMember[] = [
  { name: 'Pat', role: 'CSM', photo: 'pat.webp', isCsm: true, email: 'pat@er.com', blurb: '' },
]

describe('ProgressNav', () => {
  it('renders a mailto: anchor for the CSM chip when the matched member has an email', () => {
    const { container } = render(
      <ProgressNav
        token="tok"
        displayName="Acme"
        logoUrl={null}
        stage="kickoff"
        csmName="Pat"
        team={team}
      />,
    )
    const mailto = container.querySelector('a[href="mailto:pat@er.com"]')
    expect(mailto).not.toBeNull()
    expect(mailto!.textContent).toContain('pat@er.com')
  })

  it('renders no CSM chip when there is no roster match', () => {
    const { container } = render(
      <ProgressNav
        token="tok"
        displayName="Acme"
        logoUrl={null}
        stage="kickoff"
        csmName={null}
        team={team}
      />,
    )
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('marks the current stage in the 4-step stepper', () => {
    const { container } = render(
      <ProgressNav
        token="tok"
        displayName="Acme"
        logoUrl={null}
        stage="website-specifics"
        csmName={null}
        team={null}
      />,
    )
    const current = container.querySelector('[data-state="current"]')
    expect(current).not.toBeNull()
    expect(current!.textContent).toBe('Website Specifics')

    const states = Array.from(container.querySelectorAll('[data-state]')).map(
      (el) => el.getAttribute('data-state'),
    )
    expect(states).toEqual(['done', 'done', 'current', 'upcoming'])
  })

  it('renders no section anchor dots', () => {
    const { container } = render(
      <ProgressNav
        token="tok"
        displayName="Acme"
        logoUrl={null}
        stage="building"
        csmName={null}
        team={null}
      />,
    )
    // Section anchor dots moved to the TOC rail (Task 9) — ProgressNav v2
    // must render no #section-key anchors at all.
    expect(container.querySelectorAll('a[href^="#"]').length).toBe(0)
  })

  it('never emits a dark: class (the public viewbook is light-only)', () => {
    const { container } = render(
      <ProgressNav
        token="tok"
        displayName="Acme"
        logoUrl={null}
        stage="post-contract"
        csmName="Pat"
        team={team}
      />,
    )
    expect(container.innerHTML).not.toMatch(/dark:/)
  })
})
