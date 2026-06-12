// lib/report/vpat.test.ts
import { describe, it, expect } from 'vitest'
import { buildVpatScaffold, type VpatInput } from './vpat'

function makeInput(overrides: Partial<VpatInput> = {}): VpatInput {
  return {
    domain: 'example.edu',
    auditDate: '2026-06-12T10:00:00.000Z',
    wcagLevel: 'wcag21aa',
    pagesTotal: 3,
    rows: [
      // image-alt → 1.1.1, critical, on 3 pages
      { ruleId: 'image-alt', impact: 'critical', wcagTags: ['wcag2a', 'wcag111'], helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt', pageUrl: 'https://example.edu/' },
      { ruleId: 'image-alt', impact: 'critical', wcagTags: ['wcag2a', 'wcag111'], helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt', pageUrl: 'https://example.edu/about' },
      { ruleId: 'image-alt', impact: 'critical', wcagTags: ['wcag2a', 'wcag111'], helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt', pageUrl: 'https://example.edu/contact' },
      // color-contrast → 1.4.3, impact 'unknown' rendered verbatim
      { ruleId: 'color-contrast', impact: 'unknown', wcagTags: ['wcag2aa', 'wcag143'], helpUrl: null, pageUrl: 'https://example.edu/' },
    ],
    ...overrides,
  }
}

function row(md: string, criterionId: string): string | undefined {
  return md.split('\n').find((l) => l.startsWith(`| ${criterionId} `))
}

describe('buildVpatScaffold', () => {
  it('contains the scaffold disclaimer verbatim', () => {
    expect(buildVpatScaffold(makeInput())).toContain('**This is a scaffold, not a legal VPAT/ACR.**')
  })

  it('marks criteria with violations as Does Not Support with rule remarks', () => {
    const md = buildVpatScaffold(makeInput())
    const r = row(md, '1.1.1')!
    expect(r).toContain('Does Not Support')
    expect(r).toContain('image-alt')
    expect(r).toContain('3 pages')
    expect(r).toContain('critical')
    expect(r).toContain('https://dequeuniversity.com/rules/axe/image-alt')
  })

  it("renders impact 'unknown' verbatim", () => {
    const md = buildVpatScaffold(makeInput())
    const r = row(md, '1.4.3')!
    expect(r).toContain('Does Not Support')
    expect(r).toContain('(unknown, 1 page)')
  })

  it('marks criteria without violations as Not Evaluated', () => {
    const md = buildVpatScaffold(makeInput())
    const r = row(md, '1.2.1')!
    expect(r).toContain('Not Evaluated')
    expect(r).toContain('manual review required')
  })

  it('omits 2.2 criteria and shows the scope note at wcag21aa', () => {
    const md = buildVpatScaffold(makeInput({ wcagLevel: 'wcag21aa' }))
    expect(md).toContain('not in scan scope')
    expect(row(md, '2.5.8')).toBeUndefined()
  })

  it('includes 2.2 criteria and no scope note at wcag22aa', () => {
    const md = buildVpatScaffold(makeInput({ wcagLevel: 'wcag22aa' }))
    expect(md).not.toContain('not in scan scope')
    expect(row(md, '2.5.8')).toContain('| 2.5.8 Target Size (Minimum) |')
  })

  it('renders Level A and Level AA table headings', () => {
    const md = buildVpatScaffold(makeInput())
    expect(md).toContain('## Table 1: Success Criteria, Level A')
    expect(md).toContain('## Table 2: Success Criteria, Level AA')
  })
})
