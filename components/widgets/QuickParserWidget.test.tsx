// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
const uploadMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/seo-parser/client-upload', () => ({ uploadAndParse: uploadMock }))

import { QuickParserWidget } from './QuickParserWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); pushMock.mockReset(); uploadMock.mockReset() })

describe('QuickParserWidget', () => {
  it('uploads dropped files and redirects to the results page', async () => {
    uploadMock.mockResolvedValue({ sessionId: 'sess9' })
    render(<QuickParserWidget size="wide" />)
    const zone = screen.getByText(/drop screaming frog/i).closest('div')!
    const file = new File(['a,b'], 'internal.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser/results/sess9'))
  })

  it('shows an inline error when the upload fails', async () => {
    uploadMock.mockRejectedValue(new Error('too big'))
    render(<QuickParserWidget size="wide" />)
    const zone = screen.getByText(/drop screaming frog/i).closest('div')!
    const file = new File(['a,b'], 'internal.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/too big/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
