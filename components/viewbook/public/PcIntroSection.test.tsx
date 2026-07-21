// @vitest-environment jsdom
import { act, render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { SECTION_COPY_FIXTURE } from './test-support/section-copy-fixture'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { PcIntroSection } from './PcIntroSection'
import { welcomeRevealedKey } from './useWelcomeAutoReveal'

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const baseSection: PublicSection = {
  sectionKey: 'pc-intro',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

function data(over: Partial<ViewbookPublicData> = {}): ViewbookPublicData {
  return {
    clientName: 'Acme',
    displayName: 'Acme',
    kind: 'upgrade',
    welcomeNote: null,
    dataLockedAt: null,
    theme: DEFAULT_THEME,
    stage: 'post-contract',
    stageLabel: 'Getting Started',
    pcCompletedAt: null,
    clientNotifyJson: [],
    teamMembers: [],
    primarySections: [],
    carriedSections: [],
    fieldCategories: [],
    milestones: [],
    materials: [],
    global: { team: null, pcIntro: null, blocks: {} },
    overrides: {},
    sectionCopy: SECTION_COPY_FIXTURE,
    ...over,
  } as unknown as ViewbookPublicData
}

describe('PcIntroSection', () => {
  it('renders the pc-intro title in post-contract', () => {
    const { container } = render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(container.textContent).toContain('Welcome')
  })

  it('renders the operator-editable global copy when set', () => {
    const withCopy = data({ global: { team: null, pcIntro: 'Custom welcome copy.', blocks: {} } })
    render(<PcIntroSection section={{ ...baseSection }} data={withCopy} token="t" />)
    expect(screen.getByText('Custom welcome copy.')).toBeDefined()
  })

  it('falls back to code-owned copy when pcIntro is unset', () => {
    render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(screen.getByText(/get your viewbook set up/i)).toBeDefined()
  })

  it('returns null outside post-contract (defensive gate)', () => {
    const { container } = render(
      <PcIntroSection section={{ ...baseSection }} data={data({ stage: 'building' })} token="t" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders as a collapsible section (compact row + expand control), not a permanently-open hero (2026-07-19 welcome-auto-reveal)', () => {
    const { container } = render(<PcIntroSection section={{ ...baseSection }} data={data()} token="t" />)
    expect(container.querySelector('details')).toBeNull()
    // Default-collapsed on a fresh machine (no seeded localStorage) — same
    // compact-row + expand-control shape as every other section now that
    // pc-intro is no longer excluded from collapse.
    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[role="region"]')).not.toBeNull()
  })

  // Task 13 (docs/superpowers/sdd/task-13-brief.md): real seam test proving
  // `PcIntroSection → SectionShell → CollapsibleSection` prop threading for
  // `autoRevealMs`. PcIntroSection is the ONLY caller that ever passes a
  // defined `autoRevealMs` (`data.stage === 'post-contract' ? data.
  // firstLoadDelayMs : undefined`).
  describe('Task 13: welcome auto-reveal prop threading', () => {
    it('post-contract + firstLoadDelayMs=0 reaches the CollapsibleSection island and auto-expands', () => {
      let rafCallback: FrameRequestCallback | null = null
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb
        return 1
      })
      const { container } = render(
        <PcIntroSection
          section={{ ...baseSection }}
          data={data({ stage: 'post-contract', firstLoadDelayMs: 0, viewbookId: 7 })}
          token="t"
        />,
      )
      const root = container.querySelector('.vb-collapsible')
      expect(root?.getAttribute('data-vb-state')).toBe('collapsed')
      expect(rafCallback).not.toBeNull()

      act(() => {
        rafCallback?.(0)
      })

      expect(root?.getAttribute('data-vb-state')).toBe('expanded')
      expect(stored.get(welcomeRevealedKey(7))).toBe('1')
    })

    it('stage !== post-contract: firstLoadDelayMs=0 never reaches the island (component returns null, no auto-reveal wiring at all)', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
      const { container } = render(
        <PcIntroSection
          section={{ ...baseSection }}
          data={data({ stage: 'building', firstLoadDelayMs: 0, viewbookId: 7 })}
          token="t"
        />,
      )
      expect(container.firstChild).toBeNull()
      expect(rafSpy).not.toHaveBeenCalled()
      expect(stored.has(welcomeRevealedKey(7))).toBe(false)
    })
  })
})
