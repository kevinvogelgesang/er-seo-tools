// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DropZone } from './DropZone'

afterEach(cleanup)

describe('DropZone', () => {
  it('calls onFiles with dropped files', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} label="Drop CSVs" />)
    const zone = screen.getByText('Drop CSVs').closest('div')!
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
  it('does not fire onFiles when disabled', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} disabled label="Drop CSVs" />)
    const zone = screen.getByText('Drop CSVs').closest('div')!
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
