'use client'

import { useEffect, useState } from 'react'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { usePresentationMode } from '../../PresentationToggle'
import { InspectorPanes } from './InspectorPanes'
import { SectionOutline } from './SectionOutline'

export interface OperatorInspectorProps {
  viewbookId: number
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
  stage: ViewbookStage
}

export function OperatorInspector({ viewbookId, operatorData, pcCompletedAt, stage }: OperatorInspectorProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [canvasFit, setCanvasFit] = useState(false)
  const { initialized, presenting } = usePresentationMode()
  const canvasFitActive = canvasFit && initialized && !presenting

  useEffect(() => {
    const root = document.documentElement
    if (canvasFitActive) root.setAttribute('data-vb-canvas-fit', '')
    else root.removeAttribute('data-vb-canvas-fit')

    return () => root.removeAttribute('data-vb-canvas-fit')
  }, [canvasFitActive])

  if (!initialized || presenting) return null

  return (
    <aside
      aria-label="Viewbook editing inspector"
      data-vb-inspector
      className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[min(70vh,calc(100vh-var(--vb-sticky-offset,0px)))] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-gray-200 bg-white/95 font-body text-navy shadow-2xl backdrop-blur-md dark:border-navy-border dark:bg-navy-deep/95 dark:text-white lg:inset-x-auto lg:right-0 lg:bottom-0 lg:max-h-none lg:w-96 lg:rounded-none lg:border-y-0 lg:border-r-0 ${collapsed ? 'lg:top-auto' : 'lg:top-[var(--vb-sticky-offset,0px)]'}`}
    >
      <div data-vb-inspector-handle className="flex shrink-0 justify-center border-b border-gray-200 px-4 py-2 dark:border-navy-border">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
          onClick={() => setCollapsed((current) => !current)}
          className="flex min-h-10 w-full flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 dark:text-white/70 dark:hover:bg-white/10"
        >
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-gray-300 dark:bg-white/30" />
          <span>{collapsed ? 'Open inspector' : 'Inspector'}</span>
        </button>
      </div>
      <div data-vb-inspector-body hidden={collapsed} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex justify-end border-b border-gray-200 px-4 py-3 dark:border-navy-border">
          <button
            type="button"
            aria-label="Canvas fit"
            aria-pressed={canvasFitActive}
            onClick={() => setCanvasFit((current) => !current)}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 dark:border-navy-border dark:bg-navy-card dark:text-white dark:hover:bg-navy-light"
          >
            Fit canvas
          </button>
        </div>
        <SectionOutline operatorData={operatorData} stage={stage} pcCompletedAt={pcCompletedAt} viewbookId={viewbookId} />
        <InspectorPanes viewbookId={viewbookId} operatorData={operatorData} />
      </div>
    </aside>
  )
}
