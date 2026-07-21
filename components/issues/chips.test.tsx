// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ChangeChip } from './chips'
import type { IssueGroup } from '@/lib/sweep/types'

afterEach(() => cleanup())

const linksGroup = (over: Partial<IssueGroup> = {}): IssueGroup => ({
  clientId: 1,
  clientName: 'Acme University',
  domain: 'acme.edu',
  tool: 'seo-parser',
  type: 'empty_anchor_text',
  title: 'Empty anchor text',
  severity: 'warning',
  unit: 'links',
  affectedCount: 5,
  approximate: false,
  changeState: 'worsened',
  delta: 2,
  streak: 1,
  severityChanged: null,
  coverageState: 'comparable',
  lastObservedAt: '2026-07-21T09:00:00.000Z',
  siteAuditId: 'sa_1',
  liveScanRunId: 'run_1',
  ...over,
})

describe('ChangeChip — links unit noun', () => {
  it('renders the "links" unit for a worsened anchor group', () => {
    const { container } = render(<ChangeChip group={linksGroup()} />)
    expect(container.textContent).toMatch(/WORSENED \+2 links/)
  })
  it('renders the "links" unit for a fewer anchor group', () => {
    const { container } = render(<ChangeChip group={linksGroup({ changeState: 'fewer', delta: -1 })} />)
    expect(container.textContent).toMatch(/FEWER −1 links/)
  })
})
