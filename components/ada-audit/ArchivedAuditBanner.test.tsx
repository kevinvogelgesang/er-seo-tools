// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ArchivedAuditBanner } from './ArchivedAuditBanner'

describe('ArchivedAuditBanner', () => {
  afterEach(cleanup)

  it('page variant renders the single-page copy', () => {
    render(<ArchivedAuditBanner variant="page" />)
    expect(screen.getByText(/Archived audit:/)).toBeTruthy()
    expect(
      screen.getByText(/screenshots, complete code snippets/),
    ).toBeTruthy()
  })

  it('site variant renders the per-page copy', () => {
    render(<ArchivedAuditBanner variant="site" />)
    expect(screen.getByText(/full per-page detail was pruned/)).toBeTruthy()
  })
})
