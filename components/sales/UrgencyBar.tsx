'use client'
// C14 redesign: horizontal urgency bar. Fill animates 0 → pct on mount via a
// CSS width transition triggered one frame after commit; reduced-motion (via
// matchMedia) sets the final width immediately. Fraction is clamped 0–1.
import { useEffect, useState } from 'react'

export function UrgencyBar(props: {
  value: number
  max: number
  ariaLabel: string
  /** Tailwind classes for the fill; defaults to the red urgency treatment. */
  colorClass?: string
}) {
  const pct = props.max > 0 ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setWidth(pct)
      return
    }
    const raf = requestAnimationFrame(() => setWidth(pct))
    return () => cancelAnimationFrame(raf)
  }, [pct])

  return (
    <div
      role="img"
      aria-label={props.ariaLabel}
      className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${props.colorClass ?? 'bg-red-600 dark:bg-red-500'}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
