// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AuditBatchMember } from '@/lib/ada-audit/types'
import QueueMemberRow from './QueueMemberRow'

afterEach(() => cleanup())

function makeMember(overrides: Partial<AuditBatchMember>): AuditBatchMember {
  return {
    id: 'm1',
    domain: 'example.com',
    clientId: null,
    clientName: null,
    status: 'queued',
    pagesTotal: 0,
    pagesComplete: 0,
    pagesError: 0,
    score: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    requestedBy: null,
    seoOnly: false,
    ...overrides,
  }
}

function renderRow(member: AuditBatchMember) {
  return render(
    <table>
      <tbody>
        <QueueMemberRow member={member} />
      </tbody>
    </table>,
  )
}

describe('QueueMemberRow (C11 PR 2a IntentChip)', () => {
  it('an ADA member renders no "SEO" chip', () => {
    renderRow(makeMember({ seoOnly: false }))
    expect(screen.queryByText('SEO')).toBeNull()
  })

  it('a seoOnly member renders exactly one "SEO" chip', () => {
    renderRow(makeMember({ seoOnly: true }))
    expect(screen.getAllByText('SEO').length).toBe(1)
  })

  it('C16: a seoOnly member links to the ADA site page (it owns seoOnly routing now)', () => {
    renderRow(makeMember({ seoOnly: true, domain: 'example.com' }))
    expect(screen.getByRole('link', { name: /example\.com/i }).getAttribute('href')).toBe('/ada-audit/site/m1')
  })
})
