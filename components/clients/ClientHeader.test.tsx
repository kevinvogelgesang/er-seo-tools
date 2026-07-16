// @vitest-environment jsdom
// components/clients/ClientHeader.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ClientHeader } from './ClientHeader'

afterEach(cleanup)

describe('ClientHeader', () => {
  it('renders the Archived StatusPill for archived clients', () => {
    render(
      <ClientHeader
        name="Acme College"
        domains={['acme.example']}
        seedUrls={[]}
        teamworkTasklistId={null}
        schedules={[]}
        archivedAt="2026-06-01T00:00:00.000Z"
      />,
    )
    const el = screen.getByText('ARCHIVED')
    expect(el.className).toContain('rounded-full')
    expect(el.className).toContain('bg-gray-100')
  })

  it('shows the auto-scan line for an active client with no schedules', () => {
    render(
      <ClientHeader name="Acme" domains={['acme.example']} seedUrls={[]} teamworkTasklistId={null} schedules={[]} />,
    )
    expect(screen.getByText('Scanned automatically every Sunday')).toBeTruthy()
  })

  it('hides the auto-scan line for an archived client (excluded from the sweep)', () => {
    render(
      <ClientHeader
        name="Acme"
        domains={['acme.example']}
        seedUrls={[]}
        teamworkTasklistId={null}
        schedules={[]}
        archivedAt="2026-06-01T00:00:00.000Z"
      />,
    )
    expect(screen.queryByText('Scanned automatically every Sunday')).toBeNull()
  })
})
