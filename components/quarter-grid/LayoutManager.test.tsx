// @vitest-environment jsdom
// components/quarter-grid/LayoutManager.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { LayoutManager } from './LayoutManager'
import type { Snapshots } from '@/lib/quarter-grid/state'

afterEach(cleanup)

const layouts: Snapshots = { plana: { schedule: {}, completed: [], clients: [] } }

describe('LayoutManager', () => {
  it('save button is disabled for a blank name and enabled otherwise; save clears the input', () => {
    const saveLayout = vi.fn()
    render(<LayoutManager layouts={{}} saveLayout={saveLayout} applyLayout={vi.fn()} deleteLayout={vi.fn()} />)
    const btn = screen.getByText('💾') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const input = screen.getByPlaceholderText('save as layout…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'q3' } })
    expect((screen.getByText('💾') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('💾'))
    expect(saveLayout).toHaveBeenCalledWith('q3')
    expect(input.value).toBe('')
  })

  it('selecting a layout calls applyLayout and shows the selection; delete clears it', () => {
    const applyLayout = vi.fn(), deleteLayout = vi.fn()
    render(<LayoutManager layouts={layouts} saveLayout={vi.fn()} applyLayout={applyLayout} deleteLayout={deleteLayout} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'plana' } })
    expect(applyLayout).toHaveBeenCalledWith('plana')
    expect(select.value).toBe('plana')
    fireEvent.click(screen.getByTitle('Delete this layout'))
    expect(deleteLayout).toHaveBeenCalledWith('plana')
    expect(select.value).toBe('')
  })

  it('selecting an unknown/empty option does not call applyLayout', () => {
    const applyLayout = vi.fn()
    render(<LayoutManager layouts={layouts} saveLayout={vi.fn()} applyLayout={applyLayout} deleteLayout={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(applyLayout).not.toHaveBeenCalled()
  })
})
