// lib/widgets/grid.ts
// Pure size → Tailwind grid-span class map. Base (mobile) is always a single
// column; wider spans switch on md:/lg: so mobile stays one-column (spec §3.3).
import type { WidgetSize } from './types'

const SPANS: Record<WidgetSize, string> = {
  sm: 'col-span-1 row-span-1',
  wide: 'col-span-1 row-span-1 md:col-span-2',
  lg: 'col-span-1 row-span-1 md:col-span-2 lg:row-span-2',
  xl: 'col-span-1 row-span-1 md:col-span-2 lg:col-span-4 lg:row-span-2',
}

export function spanClass(size: WidgetSize): string {
  return SPANS[size]
}
