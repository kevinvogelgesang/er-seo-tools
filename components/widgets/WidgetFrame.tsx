'use client'
import { Component, type ReactNode } from 'react'

export function WidgetFrame({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="truncate font-display text-[13px] font-bold uppercase tracking-wide text-navy/70 dark:text-white/70">
          {title}
        </h2>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

// Render-throw safety net: a widget body that throws degrades to a single card,
// never blanks the grid (spec §6, mirrors loadOpsSnapshot fault isolation).
export class WidgetErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <WidgetFrame title={this.props.title}>
          <p className="text-[13px] font-body text-gray-400 dark:text-white/40">
            Couldn&apos;t load this widget.
          </p>
        </WidgetFrame>
      )
    }
    return this.props.children
  }
}
