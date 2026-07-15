// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { InquiryForm } from './InquiryForm'

afterEach(cleanup)

describe('InquiryForm', () => {
  it('renders the anchor target, all four fields, and submit (no "prefer email" callout)', () => {
    const { container } = render(
      <InquiryForm contactEmail="kevin@enrollmentresources.com" prospectName="Acme" domain="acme.test" />,
    )
    expect(container.querySelector('#inquiry')).toBeTruthy()
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
    expect(screen.getByLabelText(/email/i)).toBeTruthy()
    expect(screen.getByLabelText(/phone/i)).toBeTruthy()
    expect(screen.getByLabelText(/message/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
    // The "Prefer email?" mailto callout was removed (Kevin pass 4) — the form is the CTA.
    expect(screen.queryByRole('link', { name: /kevin@enrollmentresources.com/i })).toBeNull()
  })
})
