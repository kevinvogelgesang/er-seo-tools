// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'
import type { PublicSection } from '@/lib/viewbook/public-types'

afterEach(cleanup)

const section = (over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

describe('SectionShell', () => {
  it('renders an active section open with its anchor id, intro note, and summary band', () => {
    render(
      <SectionShell
        section={section({ introNote: 'A note' })}
        title="Brand Guidelines"
        heroUrl={null}
        summary={<span>3 colors locked in</span>}
      >
        <p>Body</p>
      </SectionShell>,
    )
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
    expect(screen.getByText('3 colors locked in')).toBeDefined()
  })

  it('renders a done section as a collapsed details with the completion date, body retained', () => {
    render(
      <SectionShell
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
      >
        <p>Body</p>
      </SectionShell>,
    )
    const details = document.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(screen.getByText(/Completed/)).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
  })
})
