// components/widgets/EditableWidgetTile.tsx
// Edit-mode chrome for one homepage widget: drag handle, size stepper, move
// buttons. Deliberately renders a placeholder instead of `widget.Component` —
// no queue-poll/fetch churn, no accidental quick-start submits, clean drag
// surface. Size is already communicated by the parent's grid span; this tile
// just echoes it. Reuses `WidgetFrame` so the editor reflects real packing
// (same frame, title, height, dark treatment as the live grid).
'use client'
import type { DragEvent } from 'react'
import type { LayoutItem, WidgetDef } from '@/lib/widgets/types'
import { WidgetFrame } from './WidgetFrame'

export function EditableWidgetTile({
  item,
  widget,
  index,
  total,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onDragLeave,
  onResize,
  onMove,
}: {
  item: LayoutItem
  widget: WidgetDef
  index: number
  total: number
  isDropTarget: boolean
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onDragEnd: () => void
  onDragLeave: () => void
  onResize: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const sizeIndex = widget.sizes.indexOf(item.size)
  const nextSize = widget.sizes[(sizeIndex + 1) % widget.sizes.length]

  const ringClass = isDropTarget
    ? 'ring-2 ring-orange-500 dark:ring-orange-400'
    : 'ring-2 ring-transparent dark:ring-transparent'

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      className={`h-full rounded-2xl transition-shadow ${ringClass}`}
    >
      <WidgetFrame
        title={widget.title}
        action={
          <div className="flex shrink-0 items-center gap-1">
            <span
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              aria-label={`Reorder ${widget.title}`}
              className="cursor-move select-none rounded px-1 text-[13px] leading-none text-gray-400 hover:text-navy dark:text-white/40 dark:hover:text-white"
            >
              ⠿
            </span>
            {widget.sizes.length > 1 && (
              <button
                type="button"
                onClick={onResize}
                aria-label={`Size: ${item.size}. Change to ${nextSize}`}
                className="rounded px-1.5 py-0.5 text-[11px] font-body uppercase tracking-wide text-gray-500 hover:bg-gray-100 dark:text-white/50 dark:hover:bg-navy-deep"
              >
                {item.size}
              </button>
            )}
            <button
              type="button"
              onClick={() => onMove('up')}
              disabled={index === 0}
              aria-label={`Move ${widget.title} earlier`}
              className="rounded px-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-white/50 dark:hover:bg-navy-deep"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove('down')}
              disabled={index === total - 1}
              aria-label={`Move ${widget.title} later`}
              className="rounded px-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-white/50 dark:hover:bg-navy-deep"
            >
              ↓
            </button>
          </div>
        }
      >
        <div className="flex h-full items-center justify-center">
          <span className="text-[13px] font-body text-gray-400 dark:text-white/40">
            Size: {item.size}
          </span>
        </div>
      </WidgetFrame>
    </div>
  )
}
