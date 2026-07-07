// lib/widgets/types.ts
import type { ComponentType } from 'react'

// sm = 1×1, wide = 2×1, lg = 2×2, xl = 4×2 (desktop grid units); spec §3.3.
export type WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'

export interface LayoutItem {
  id: string
  size: WidgetSize
}

export interface WidgetDef {
  id: string
  title: string
  sizes: WidgetSize[]
  defaultSize: WidgetSize
  Component: ComponentType<{ size: WidgetSize }>
}
