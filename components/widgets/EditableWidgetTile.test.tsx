// components/widgets/EditableWidgetTile.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { EditableWidgetTile } from './EditableWidgetTile'
import { QuickSiteAuditWidget } from './QuickSiteAuditWidget'
import type { WidgetDef, LayoutItem } from '@/lib/widgets/types'

afterEach(cleanup)

const multiSizeWidget: WidgetDef = {
  id: 'quick-site-audit',
  title: 'Start a site audit',
  sizes: ['sm', 'wide', 'lg'],
  defaultSize: 'wide',
  Component: QuickSiteAuditWidget,
}

const singleSizeWidget: WidgetDef = {
  id: 'quick-robots',
  title: 'Check robots.txt',
  sizes: ['sm'],
  defaultSize: 'sm',
  Component: QuickSiteAuditWidget, // body irrelevant — it's always suppressed
}

const item: LayoutItem = { id: 'quick-site-audit', size: 'wide' }

type Props = ComponentProps<typeof EditableWidgetTile>

function renderTile(overrides: Partial<Props> = {}) {
  const props: Props = {
    item,
    widget: multiSizeWidget,
    index: 1,
    total: 3,
    isDropTarget: false,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
    onDragLeave: vi.fn(),
    onResize: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  }
  render(<EditableWidgetTile {...props} />)
  return props
}

describe('EditableWidgetTile', () => {
  it('renders the widget title and a size label, without mounting the live body', () => {
    renderTile()
    expect(screen.getByText('Start a site audit')).toBeTruthy()
    expect(screen.getByText('Size: wide')).toBeTruthy()
    // QuickSiteAuditWidget's own input must not be mounted.
    expect(screen.queryByPlaceholderText('example.com')).toBeNull()
  })

  it('only the drag handle is draggable; dragStart on it fires onDragStart', () => {
    const props = renderTile()
    const handle = screen.getByLabelText('Reorder Start a site audit')
    expect(handle.getAttribute('draggable')).toBe('true')

    const tileRoot = handle.closest('section')?.parentElement
    expect(tileRoot).toBeTruthy()
    expect(tileRoot?.getAttribute('draggable')).not.toBe('true')

    fireEvent.dragStart(handle)
    expect(props.onDragStart).toHaveBeenCalledTimes(1)
  })

  it('size stepper calls onResize on click and names current + next size', () => {
    const props = renderTile()
    const stepper = screen.getByLabelText('Size: wide. Change to lg')
    fireEvent.click(stepper)
    expect(props.onResize).toHaveBeenCalledTimes(1)
  })

  it('hides the size stepper when the widget has only one size', () => {
    renderTile({ widget: singleSizeWidget, item: { id: 'quick-robots', size: 'sm' } })
    expect(screen.queryByLabelText(/^Size:/)).toBeNull()
  })

  it('disables the up button at index 0 (down stays enabled)', () => {
    renderTile({ index: 0, total: 3 })
    const up = screen.getByLabelText('Move Start a site audit earlier') as HTMLButtonElement
    const down = screen.getByLabelText('Move Start a site audit later') as HTMLButtonElement
    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(false)
  })

  it('disables the down button at the last index (up stays enabled)', () => {
    renderTile({ index: 2, total: 3 })
    const up = screen.getByLabelText('Move Start a site audit earlier') as HTMLButtonElement
    const down = screen.getByLabelText('Move Start a site audit later') as HTMLButtonElement
    expect(up.disabled).toBe(false)
    expect(down.disabled).toBe(true)
  })

  it('both move buttons enabled in the middle and call onMove with the right direction', () => {
    const props = renderTile({ index: 1, total: 3 })
    fireEvent.click(screen.getByLabelText('Move Start a site audit earlier'))
    expect(props.onMove).toHaveBeenCalledWith('up')
    fireEvent.click(screen.getByLabelText('Move Start a site audit later'))
    expect(props.onMove).toHaveBeenCalledWith('down')
  })

  it('tile surface carries dark: classes', () => {
    renderTile()
    const handle = screen.getByLabelText('Reorder Start a site audit')
    const tileRoot = handle.closest('section')?.parentElement
    expect(tileRoot?.className).toMatch(/dark:/)
  })
})
