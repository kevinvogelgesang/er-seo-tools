'use client'
import { useState } from 'react'
import type { DragEvent } from 'react'
import { WIDGETS } from '@/lib/widgets/registry'
import { spanClass } from '@/lib/widgets/grid'
import { WidgetFrame, WidgetErrorBoundary } from './WidgetFrame'
import { EditableWidgetTile } from './EditableWidgetTile'
import { useHomeLayout } from '@/lib/widgets/use-home-layout'

// Desktop-only controls: CSS-gated (`hidden md:inline-flex`), never a
// `window.innerWidth` read at render — keeps server/first-paint markup
// identical regardless of viewport (plan Architecture §4).
const CONTROL_BUTTON_CLASS =
  'hidden md:inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-body font-medium text-navy hover:bg-gray-50 dark:border-navy-border dark:bg-navy-card dark:text-white dark:hover:bg-navy-deep'

export function DashboardGrid() {
  const { layout, dispatch } = useHomeLayout()
  const [editing, setEditing] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const clearDrag = () => {
    setDraggingId(null)
    setDropTargetId(null)
  }

  const startDrag = (e: DragEvent, id: string) => {
    setDraggingId(id)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const overTile = (e: DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(id)
  }

  const dropOnTile = (e: DragEvent, id: string) => {
    e.preventDefault()
    if (draggingId) dispatch({ type: 'reorder', draggedId: draggingId, targetId: id })
    clearDrag()
  }

  const dropAtEnd = (e: DragEvent) => {
    e.preventDefault()
    if (draggingId) dispatch({ type: 'reorder', draggedId: draggingId, targetId: null })
    clearDrag()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => dispatch({ type: 'reset' })}
              className={CONTROL_BUTTON_CLASS}
            >
              Reset layout
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={CONTROL_BUTTON_CLASS}
            >
              Done
            </button>
          </>
        ) : (
          <div className="flex w-full justify-end">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-pressed={editing}
              className={CONTROL_BUTTON_CLASS}
            >
              Customize
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(190px,auto)]">
        {layout.map((item, index) => {
          const widget = WIDGETS.find((w) => w.id === item.id)
          if (!widget) return null
          const Body = widget.Component
          return (
            <div key={item.id} className={spanClass(item.size)}>
              {editing ? (
                <EditableWidgetTile
                  item={item}
                  widget={widget}
                  index={index}
                  total={layout.length}
                  isDropTarget={dropTargetId === item.id}
                  onDragStart={(e) => startDrag(e, item.id)}
                  onDragOver={(e) => overTile(e, item.id)}
                  onDrop={(e) => dropOnTile(e, item.id)}
                  onDragEnd={clearDrag}
                  onDragLeave={() => setDropTargetId(null)}
                  onResize={() => dispatch({ type: 'resize', id: item.id })}
                  onMove={(dir) => dispatch({ type: 'move', id: item.id, dir })}
                />
              ) : (
                <WidgetErrorBoundary title={widget.title}>
                  <WidgetFrame title={widget.title}>
                    <Body size={item.size} />
                  </WidgetFrame>
                </WidgetErrorBoundary>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={dropAtEnd}
          className="mt-2 flex h-10 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-[12px] font-body text-gray-400 dark:border-navy-border dark:text-white/40"
        >
          Drop here to move to end
        </div>
      )}
    </div>
  )
}
