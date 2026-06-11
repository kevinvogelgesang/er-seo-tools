// @vitest-environment jsdom
// components/quarter-grid/Chip.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Chip } from './Chip'
import type { GridClient } from '@/lib/quarter-grid/grid-ops'

afterEach(cleanup) // globals:false → no auto-cleanup

const client = (over: Partial<GridClient> = {}): GridClient =>
  ({ id: 7, name: 'Acme College', priority: 2, status: 'not_started', note: '', ...over })

const handlers = () => ({
  onDragStart: vi.fn(), onDragEnd: vi.fn(), onToggleDone: vi.fn(),
  onSetPriority: vi.fn(), onReturn: vi.fn(), onSetStatus: vi.fn(), onOpenNote: vi.fn(),
})

describe('Chip', () => {
  it('cycles status in ALL_STATUSES order when the status dot is clicked', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle(/Status: Not Started/))
    expect(h.onSetStatus).toHaveBeenCalledWith(7, 'in_progress')
  })

  it('wraps status cycling from complete back to not_started', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client({ status: 'complete' })} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle(/Status: Complete/))
    expect(h.onSetStatus).toHaveBeenCalledWith(7, 'not_started')
  })

  it('checkbox toggles done', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(h.onToggleDone).toHaveBeenCalledWith(7)
  })

  it('priority select fires onSetPriority with a number', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.change(screen.getByTitle('Priority 1=High, 5=Low'), { target: { value: '5' } })
    expect(h.onSetPriority).toHaveBeenCalledWith(7, 5)
  })

  it('renders the return-× only when fromWeek != null, and it fires onReturn', () => {
    const h = handlers()
    const { rerender } = render(<Chip id={7} fromWeek={null} client={client()} done={false} isDragging={false} {...h} />)
    expect(screen.queryByTitle('Return to pool')).toBeNull()
    rerender(<Chip id={7} fromWeek={3} client={client()} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle('Return to pool'))
    expect(h.onReturn).toHaveBeenCalledWith(7)
  })

  it('note pencil opens the note with the current text', () => {
    const h = handlers()
    render(<Chip id={7} fromWeek={null} client={client({ note: 'call them' })} done={false} isDragging={false} {...h} />)
    fireEvent.click(screen.getByTitle('Note: call them'))
    expect(h.onOpenNote).toHaveBeenCalledWith(7, 'call them')
  })
})
