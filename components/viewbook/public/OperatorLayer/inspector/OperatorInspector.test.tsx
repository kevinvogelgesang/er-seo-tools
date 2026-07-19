// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OperatorInspector } from './OperatorInspector'
import { SelectionProvider } from './SelectionContext'
import { SectionActivityProvider } from './useSectionActivity'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const od: any = { theme: DEFAULT_THEME, sections: [], fields: [], milestones: [], docs: { global: [], own: [] }, welcomeNote: null, dataLockedAt: null, dataLockedBy: null, pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [] }

describe('OperatorInspector', () => {
  it('composes a complementary dock with outline + panes; not fixed below lg', () => {
    const { container } = render(
      <SelectionProvider><SectionActivityProvider>
        <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
      </SectionActivityProvider></SelectionProvider>,
    )
    expect(screen.getByRole('complementary', { name: /viewbook editing inspector/i })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: /section outline/i })).toBeTruthy()
    expect(screen.getByRole('region', { name: /section editors/i })).toBeTruthy()
    const aside = container.querySelector('[data-vb-inspector]') as HTMLElement
    expect(aside.className.includes('hidden')).toBe(true)      // hidden below lg (no empty block)
    expect(aside.className.includes('lg:fixed')).toBe(true)
  })
})
