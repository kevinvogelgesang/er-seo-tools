// Shared anchor builders (PR7 Task 8) — the ONE home so the TOC/search index
// and section-rendering DOM ids can never drift (Codex fix 6).
import { describe, expect, it } from 'vitest'
import {
  sectionAnchor,
  categoryAnchor,
  fieldAnchor,
  milestoneAnchor,
  materialAnchor,
  docAnchor,
} from './anchors'

describe('sectionAnchor', () => {
  it('renders the section key as a bare hash id', () => {
    expect(sectionAnchor('data-source')).toBe('#data-source')
    expect(sectionAnchor('milestones')).toBe('#milestones')
  })
})

describe('categoryAnchor', () => {
  it('prefixes vb-cat-', () => {
    expect(categoryAnchor('school')).toBe('#vb-cat-school')
    expect(categoryAnchor('team-access')).toBe('#vb-cat-team-access')
  })
})

describe('fieldAnchor', () => {
  it('prefixes vb-field-', () => {
    expect(fieldAnchor(42)).toBe('#vb-field-42')
  })
})

describe('milestoneAnchor', () => {
  it('prefixes vb-milestone-', () => {
    expect(milestoneAnchor(7)).toBe('#vb-milestone-7')
  })
})

describe('materialAnchor', () => {
  it('prefixes vb-material-', () => {
    expect(materialAnchor(3)).toBe('#vb-material-3')
  })
})

describe('docAnchor', () => {
  it('prefixes vb-doc- with the filename verbatim', () => {
    expect(docAnchor('brand-guide.pdf')).toBe('#vb-doc-brand-guide.pdf')
  })
})
