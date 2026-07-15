'use client'
// C14 redesign: large SVG arc gauge (~240° sweep) with the "engine rev"
// timeline on mount — rev 0→100 (ease-in, ~0.9s) → hold (~0.2s) → fall back
// to the real score with an overshoot/bounce settle (~0.8s). One rAF-driven
// timeline (no animation library); the readout ticks in sync; the loop is
// cancelled on unmount and the score input is clamped to finite 0–100 (spec
// Codex fix 7). prefers-reduced-motion (via matchMedia): final state
// immediately. Arc color tracks the CURRENT needle value through the house
// grade thresholds (red < 60, amber 60–89, green ≥ 90 — gradeForScore).
import { useEffect, useRef, useState } from 'react'

const SWEEP_DEG = 240
const START_DEG = 150 // 150° → 390°: opening faces down
const REV_MS = 900
const HOLD_MS = 200
const FALL_MS = 800

const CX = 120
const CY = 120
const R = 96
const STROKE = 16

function clampScore(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null
  return Math.min(100, Math.max(0, v))
}

// Grade thresholds shared with SectionCard.gradeForScore (kept as literals —
// this is a client leaf; do not import server modules here).
function gaugeColor(v: number): string {
  if (v >= 90) return '#16a34a' // green-600
  if (v >= 60) return '#d97706' // amber-600
  return '#dc2626' // red-600
}

function easeInCubic(p: number): number {
  return p * p * p
}
function easeOutBack(p: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

function polar(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

function arcPath(fromDeg: number, toDeg: number): string {
  const from = polar(fromDeg, R)
  const to = polar(toDeg, R)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
}

export function ScoreGauge(props: { score: number | null }) {
  const target = clampScore(props.score)
  // SSR/no-JS/print render the FINAL value (honest static state); the mount
  // effect restarts from 0 only when motion is allowed.
  const [display, setDisplay] = useState<number | null>(target)
  const rafRef = useRef(0)

  useEffect(() => {
    if (target === null) {
      setDisplay(null)
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setDisplay(target)
      return
    }
    const startedAt = performance.now()
    const tick = (now: number) => {
      const t = now - startedAt
      let v: number
      if (t < REV_MS) {
        v = 100 * easeInCubic(t / REV_MS)
      } else if (t < REV_MS + HOLD_MS) {
        v = 100
      } else if (t < REV_MS + HOLD_MS + FALL_MS) {
        const p = (t - REV_MS - HOLD_MS) / FALL_MS
        v = 100 + (target - 100) * easeOutBack(p) // easeOutBack > 1 ⇒ slight overshoot past the target, then settle
      } else {
        setDisplay(target)
        return // timeline done — stop scheduling
      }
      setDisplay(Math.min(100, Math.max(0, v)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  const value = display
  const angle = START_DEG + (SWEEP_DEG * (value ?? 0)) / 100
  const color = value === null ? '#9ca3af' : gaugeColor(value)
  const needleTip = polar(angle, R - STROKE / 2 - 10)
  const needleBase = polar(angle, 26)

  return (
    <div className="flex flex-col items-center" role="img" aria-label={value === null ? 'Overall score not available' : `Overall score ${Math.round(value)} out of 100`}>
      <svg viewBox="0 0 240 210" className="w-56 sm:w-64">
        {/* track */}
        <path d={arcPath(START_DEG, START_DEG + SWEEP_DEG)} fill="none" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth={STROKE} strokeLinecap="round" />
        {/* value arc */}
        {value !== null && value > 0 && (
          <path d={arcPath(START_DEG, angle)} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
        )}
        {/* needle */}
        {value !== null && (
          <>
            <line x1={needleBase.x} y1={needleBase.y} x2={needleTip.x} y2={needleTip.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={7} fill={color} />
          </>
        )}
        {/* readout */}
        <text x={CX} y={CY + 52} textAnchor="middle" className="font-heading fill-current text-navy dark:text-white" fontSize="44" fontWeight="700">
          {value === null ? '—' : Math.round(value)}
        </text>
        {value !== null && (
          <text x={CX} y={CY + 72} textAnchor="middle" className="font-body fill-current text-navy/50 dark:text-white/50" fontSize="12">
            out of 100
          </text>
        )}
      </svg>
      <p className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50 text-center">
        Overall score — average of the audit areas below.
      </p>
    </div>
  )
}
