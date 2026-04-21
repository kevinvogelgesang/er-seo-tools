'use client'

import { useState } from 'react'

const SCALE: { token: string; rem: number; px: number }[] = [
  { token: '0',   rem: 0,     px: 0 },
  { token: '0.5', rem: 0.125, px: 2 },
  { token: '1',   rem: 0.25,  px: 4 },
  { token: '1.5', rem: 0.375, px: 6 },
  { token: '2',   rem: 0.5,   px: 8 },
  { token: '2.5', rem: 0.625, px: 10 },
  { token: '3',   rem: 0.75,  px: 12 },
  { token: '4',   rem: 1,     px: 16 },
  { token: '5',   rem: 1.25,  px: 20 },
  { token: '6',   rem: 1.5,   px: 24 },
  { token: '8',   rem: 2,     px: 32 },
  { token: '10',  rem: 2.5,   px: 40 },
  { token: '12',  rem: 3,     px: 48 },
  { token: '14',  rem: 3.5,   px: 56 },
  { token: '16',  rem: 4,     px: 64 },
  { token: '20',  rem: 5,     px: 80 },
  { token: '24',  rem: 6,     px: 96 },
  { token: '32',  rem: 8,     px: 128 },
  { token: '40',  rem: 10,    px: 160 },
  { token: '48',  rem: 12,    px: 192 },
]

const MAX_PX = 192

export function SpacingScale() {
  const [selected, setSelected] = useState<string>('4')
  const [property, setProperty] = useState<'p' | 'px' | 'py' | 'm' | 'gap'>('p')

  const selectedStep = SCALE.find((s) => s.token === selected) ?? SCALE[7]

  return (
    <div className="bg-navy-card border border-navy-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-navy-border bg-[#0f1118]">
        <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">
          Spacing scale · 1 unit = 0.25rem = 4px
        </span>
        <div className="flex items-center gap-1">
          {(['p', 'px', 'py', 'm', 'gap'] as const).map((prop) => (
            <button
              key={prop}
              onClick={() => setProperty(prop)}
              className={`font-mono text-[10px] uppercase border rounded px-2 py-0.5 ${
                property === prop
                  ? 'border-orange text-orange'
                  : 'border-navy-border text-white/40 hover:text-white/60'
              }`}
            >
              {prop}-
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_280px] divide-y md:divide-y-0 md:divide-x divide-navy-border">
        {/* Bars */}
        <div className="p-4 space-y-1.5">
          {SCALE.map((s) => {
            const isActive = s.token === selected
            const width = `${(s.px / MAX_PX) * 100}%`
            return (
              <button
                key={s.token}
                onClick={() => setSelected(s.token)}
                className={`flex items-center w-full gap-3 group text-left ${
                  isActive ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                }`}
              >
                <span
                  className={`font-mono text-[11px] w-16 flex-shrink-0 text-right ${
                    isActive ? 'text-orange' : 'text-white/55 group-hover:text-white/80'
                  }`}
                >
                  {property}-{s.token}
                </span>
                <div className="flex-1 h-5 bg-navy-deep rounded overflow-hidden relative">
                  <div
                    className={`h-full transition-all ${
                      isActive ? 'bg-orange' : 'bg-blue-500/60 group-hover:bg-blue-400'
                    }`}
                    style={{ width: s.px === 0 ? '2px' : width }}
                  />
                </div>
                <span className="font-mono text-[10px] w-20 flex-shrink-0 text-white/40">
                  {s.px}px · {s.rem}rem
                </span>
              </button>
            )
          })}
        </div>

        {/* Live demo */}
        <div className="p-4 bg-navy-deep/40">
          <div className="font-mono text-[10px] text-white/40 tracking-widest uppercase mb-3">
            Live demo
          </div>
          <div className="rounded-md border border-navy-border bg-navy-card overflow-hidden">
            {property === 'gap' ? (
              <div className="flex bg-navy-deep" style={{ gap: `${selectedStep.px}px`, padding: '12px' }}>
                <div className="flex-1 h-12 bg-blue-500/60 rounded" />
                <div className="flex-1 h-12 bg-blue-500/60 rounded" />
                <div className="flex-1 h-12 bg-blue-500/60 rounded" />
              </div>
            ) : property === 'm' ? (
              <div className="bg-navy-deep p-3 flex items-center justify-center min-h-[160px]">
                <div
                  className="bg-orange text-navy-deep font-mono text-[10px] flex items-center justify-center rounded"
                  style={{ margin: `${selectedStep.px}px`, padding: '20px 28px' }}
                >
                  margin
                </div>
              </div>
            ) : (
              <div className="bg-navy-deep p-3 flex items-center justify-center min-h-[160px]">
                <div
                  className="bg-orange/30 border border-orange/50 rounded inline-flex items-center justify-center"
                  style={{
                    paddingLeft: property === 'p' || property === 'px' ? `${selectedStep.px}px` : 0,
                    paddingRight: property === 'p' || property === 'px' ? `${selectedStep.px}px` : 0,
                    paddingTop: property === 'p' || property === 'py' ? `${selectedStep.px}px` : 0,
                    paddingBottom: property === 'p' || property === 'py' ? `${selectedStep.px}px` : 0,
                  }}
                >
                  <div className="bg-orange text-navy-deep font-mono text-[10px] px-3 py-1.5 rounded">
                    content
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 font-mono text-[11px] text-white/55">
            <span className="text-white/40">applied:</span>{' '}
            <span className="text-orange">{property}-{selected}</span>{' '}
            <span className="text-white/30">→</span>{' '}
            <span className="text-blue-300">{selectedStep.px}px</span>
          </div>
        </div>
      </div>
    </div>
  )
}
