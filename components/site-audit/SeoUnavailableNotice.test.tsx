// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SeoUnavailableNotice from './SeoUnavailableNotice'

afterEach(cleanup)

it('renders the explicit unavailable copy', () => {
  render(<SeoUnavailableNotice />)
  expect(screen.getByText(/SEO analysis unavailable/i)).toBeTruthy()
  expect(screen.getByText(/re-run the audit/i)).toBeTruthy()
})
