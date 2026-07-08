// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('./SeoScanForm', () => ({ SeoScanForm: () => <div data-testid="scan-panel" /> }))
vi.mock('./SeoUploadCard', () => ({ SeoUploadCard: () => <div data-testid="upload-panel" /> }))
import { SeoAuditTabs } from './SeoAuditTabs'

it('defaults to the Scan tab and switches to Upload', () => {
  render(<SeoAuditTabs />)
  expect(screen.getByTestId('scan-panel')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /Scan a URL/i }).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: /Upload Screaming Frog/i }))
  expect(screen.getByTestId('upload-panel')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /Upload Screaming Frog/i }).getAttribute('aria-selected')).toBe('true')
})
