'use client'

import { useEffect, useState } from 'react'

const BREAKPOINTS: { name: string; min: number; color: string }[] = [
  { name: 'mobile', min: 0,    color: '#94a3b8' },
  { name: 'sm',     min: 640,  color: '#60a5fa' },
  { name: 'md',     min: 768,  color: '#34d399' },
  { name: 'lg',     min: 1024, color: '#fbbf24' },
  { name: 'xl',     min: 1280, color: '#fb923c' },
  { name: '2xl',    min: 1536, color: '#f87171' },
]

function bpFor(w: number) {
  let cur = BREAKPOINTS[0]
  for (const b of BREAKPOINTS) {
    if (w >= b.min) cur = b
  }
  return cur
}

export function BreakpointIndicator() {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  if (width == null) return null

  const bp = bpFor(width)

  return (
    <div className="fixed bottom-4 right-4 z-40 hidden sm:flex items-center gap-2 bg-navy-deep/95 backdrop-blur border border-navy-border rounded-full pl-2 pr-3 py-1 shadow-lg font-mono">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: bp.color }}
      />
      <span className="text-[10px] tracking-widest uppercase font-bold" style={{ color: bp.color }}>
        {bp.name}
      </span>
      <span className="text-white/30 text-[10px]">·</span>
      <span className="text-white/50 text-[10px]">{width}px</span>
    </div>
  )
}
