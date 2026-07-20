import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// PR8 spec §13: the anonymous public payload must contain NO operator layer,
// controls, or operator/read-model data. The strongest guarantee is that the
// operator read model is never even LOADED on the anonymous path (so it can
// never be serialized), and that the anonymous branch returns the plain
// ViewbookShell — not the OperatorViewbookLayer.

const loadViewbookPublicData = vi.fn()
const getOperatorEmailForPublicPage = vi.fn()
const loadOperatorViewbookData = vi.fn()
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('@/lib/viewbook/public-data', () => ({
  loadViewbookPublicData: (...a: unknown[]) => loadViewbookPublicData(...a),
}))
vi.mock('@/lib/viewbook/public-session', () => ({
  getOperatorEmailForPublicPage: (...a: unknown[]) => getOperatorEmailForPublicPage(...a),
}))
vi.mock('@/lib/viewbook/operator-data', () => ({
  loadOperatorViewbookData: (...a: unknown[]) => loadOperatorViewbookData(...a),
}))
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/viewbook/tok',
  useSearchParams: () => new URLSearchParams(),
}))

import ViewbookPage from './page'
import { ViewbookShell } from '@/components/viewbook/public/ViewbookShell'
import { OperatorViewbookLayer } from '@/components/viewbook/public/OperatorLayer'

const OPERATOR_MARKERS = [
  'data-operator-viewbook-layer',
  'data-operator-bar',
  'data-operator-section-wrapper',
  'data-operator-section-controls',
  'data-operator-hidden-sections',
  'data-operator-inline-editor',
  'data-vb-inspector',
  'data-vb-section-outline',
  'data-vb-inspector-panes',
  // PR6: re-assert the section BOUNDARY marker never leaks into the anonymous
  // render either (the scroll-spy target the operator layer wraps sections in).
  'data-operator-section',
]

function publicData() {
  return {
    viewbookId: 7,
    stage: 'post-contract',
    stageLabel: 'Getting Started',
    syncVersion: 0,
    displayName: 'Acme',
    clientName: 'Acme',
    kind: 'existing',
    pcCompletedAt: null,
    clientNotifyJson: [],
    teamMembers: [],
    csmName: null,
    welcomeNote: null,
    dataLockedAt: null,
    primarySections: [],
    carriedSections: [],
    fieldCategories: [],
    milestones: [],
    materials: [],
    docs: [],
    overrides: {},
    global: {},
    theme: { primary: '#122033', secondary: '#334155', tertiary: '#c99334', headingFont: 'abril-fatface', bodyFont: 'inter', logo: null, sectionHeroes: {} },
  } as unknown as Awaited<ReturnType<typeof loadViewbookPublicData>>
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('ViewbookPage anonymous vs operator branch (spec §13)', () => {
  it('anonymous session renders ViewbookShell and NEVER loads the operator read model', async () => {
    loadViewbookPublicData.mockResolvedValue(publicData())
    getOperatorEmailForPublicPage.mockResolvedValue(null)

    const el = await ViewbookPage({ params: Promise.resolve({ token: 'tok' }) })

    expect(isValidElement(el)).toBe(true)
    // The plain shell, not the operator layer.
    expect((el as { type: unknown }).type).toBe(ViewbookShell)
    expect((el as { props: { resolvedFonts: { heading: { family: string } } } }).props.resolvedFonts.heading.family).toBe('Abril Fatface')
    // The load-bearing no-leak guarantee: operator data is never even fetched.
    expect(loadOperatorViewbookData).not.toHaveBeenCalled()

    // And no operator markers / operator email appear in the rendered markup.
    const html = renderToStaticMarkup(el)
    for (const marker of OPERATOR_MARKERS) {
      expect(html.includes(marker)).toBe(false)
    }
  })

  it('verified-operator session renders OperatorViewbookLayer with the read model', async () => {
    loadViewbookPublicData.mockResolvedValue(publicData())
    getOperatorEmailForPublicPage.mockResolvedValue('op@example.com')
    loadOperatorViewbookData.mockResolvedValue({ pcCompletedAt: null, sections: [] })

    const el = await ViewbookPage({ params: Promise.resolve({ token: 'tok' }) })

    expect(isValidElement(el)).toBe(true)
    expect((el as { type: unknown }).type).toBe(OperatorViewbookLayer)
    expect(loadOperatorViewbookData).toHaveBeenCalledWith(7)
    const props = (el as { props: Record<string, unknown> }).props
    expect(props.operatorEmail).toBe('op@example.com')
    expect(props.viewbookId).toBe(7)

    // P1 regression guard (Codex PR8 review): Next.js cannot serialize
    // functions across the Server→Client boundary, so the operator layer must
    // receive NO function-typed props. The old `renderSection`/`renderViewbook`
    // closures are GONE; the section tree crosses as `children` (a ReactNode).
    expect(props.renderSection).toBeUndefined()
    expect(props.renderViewbook).toBeUndefined()
    for (const [key, value] of Object.entries(props)) {
      expect(typeof value, `prop "${key}" must not be a function`).not.toBe('function')
    }
    expect(isValidElement(props.children)).toBe(true)
    expect((props.children as { props: { resolvedFonts: { heading: { family: string } } } }).props.resolvedFonts.heading.family).toBe('Abril Fatface')
  })
})
