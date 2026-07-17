// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { BrandSection } from './BrandSection'

afterEach(cleanup)

const section: PublicSection = {
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  acknowledgedAt: null,
  introNote: null,
  narrative: null,
}

const data: ViewbookPublicData = {
  clientName: 'Acme',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  stage: 'website-specifics',
  stageLabel: 'Website Specifics',
  primarySections: [],
  carriedSections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  global: { team: null, blocks: {} },
  overrides: {},
} as unknown as ViewbookPublicData

describe('BrandSection', () => {
  it('mounts the Task-3 contrast tester alongside the palette + typography specimens', () => {
    render(<BrandSection section={section} data={data} token="tok" />)
    expect(screen.getAllByTestId('contrast-ratio').length).toBeGreaterThan(0)
    expect(screen.getByText('Palette')).toBeDefined()
    expect(screen.getByText('Typography')).toBeDefined()
    expect(screen.getByText(/Contrast checker/i)).toBeDefined()
  })
})
