// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SectionOutline, buildOutlineRows } from './SectionOutline'
import { InspectorPanes } from './InspectorPanes'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const od: any = { theme: DEFAULT_THEME, sections: [], fields: [], milestones: [], docs: { global: [], own: [] }, welcomeNote: null, dataLockedAt: null, dataLockedBy: null, pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [] }

describe('inspector placeholders', () => {
  it('outline renders its navigation landmark and buildOutlineRows is callable', () => {
    expect(Array.isArray(buildOutlineRows(od, 'kickoff' as any, null))).toBe(true)
    render(<SectionOutline operatorData={od} stage={'kickoff' as any} pcCompletedAt={null} viewbookId={1} />)
    expect(screen.getByRole('navigation', { name: /section outline/i })).toBeTruthy()
  })
  it('panes render their region landmark', () => {
    render(<InspectorPanes viewbookId={1} operatorData={od} />)
    expect(screen.getByRole('region', { name: /section editors/i })).toBeTruthy()
  })
})
