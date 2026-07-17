// @vitest-environment jsdom
// Regression coverage for the Codex-review finding: EarlierSteps must render
// INSIDE the body-font-scoped wrapper (the div carrying
// `fontFamily: var(--vb-body-font)`), not after it — otherwise carried
// sections silently fall back to the app default font.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { ViewbookShell } from './ViewbookShell'
import { __resetSyncRegistry } from './useViewbookSync'

// ViewbookShell now mounts ViewbookSyncClient (PR2 Task 6), a 'use client'
// island that calls useRouter() — this test renders outside an app router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

afterEach(() => {
  cleanup()
  __resetSyncRegistry()
  vi.unstubAllGlobals()
})

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey,
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
})

const data = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'building',
  stageLabel: 'Now Building',
  primarySections: [],
  carriedSections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  global: { team: null, blocks: {} },
  overrides: {},
  ...over,
})

describe('ViewbookShell', () => {
  it('renders carried sections as a descendant of the body-font-scoped element', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({
          primarySections: [sec('strategy')],
          carriedSections: [sec('brand')],
        })}
        primarySections={[sec('strategy')]}
        carriedSections={[sec('brand')]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )

    // Locate the element that actually carries the --vb-body-font style —
    // don't hardcode which DOM node it is, just find it by its inline style.
    const fontScoped = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.style.fontFamily === 'var(--vb-body-font)',
    )
    expect(fontScoped).toBeDefined()

    const carriedNode = container.querySelector('[data-testid="section-brand"]')
    expect(carriedNode).not.toBeNull()

    // The carried section must be a DOM descendant of the font-scoped element
    // (not a sibling rendered after it) — this is the regression the Codex
    // finding flagged.
    expect(fontScoped!.contains(carriedNode)).toBe(true)

    // Sanity: the primary section is (and always was) inside the same scope.
    const primaryNode = container.querySelector('[data-testid="section-strategy"]')
    expect(fontScoped!.contains(primaryNode)).toBe(true)
  })

  it('renders nothing extra when there are no carried sections (EarlierSteps stays a no-op)', () => {
    const { container } = render(
      <ViewbookShell
        token="tok"
        data={data({ primarySections: [sec('welcome')] })}
        primarySections={[sec('welcome')]}
        carriedSections={[]}
        renderSection={(s) => <p data-testid={`section-${s.sectionKey}`}>{s.sectionKey} body</p>}
      />,
    )
    expect(container.querySelector('details')).toBeNull()
  })
})
