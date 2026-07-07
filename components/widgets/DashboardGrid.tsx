'use client'
import { WIDGETS, DEFAULT_LAYOUT } from '@/lib/widgets/registry'
import { spanClass } from '@/lib/widgets/grid'
import { WidgetFrame, WidgetErrorBoundary } from './WidgetFrame'

export function DashboardGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(190px,auto)]">
      {DEFAULT_LAYOUT.map((item) => {
        const widget = WIDGETS.find((w) => w.id === item.id)
        if (!widget) return null
        const Body = widget.Component
        return (
          <div key={item.id} className={spanClass(item.size)}>
            <WidgetErrorBoundary title={widget.title}>
              <WidgetFrame title={widget.title}>
                <Body size={item.size} />
              </WidgetFrame>
            </WidgetErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}
