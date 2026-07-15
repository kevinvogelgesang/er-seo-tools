'use client'
// C14 redesign: large SVG arc gauge (~240° sweep) with a "slam-and-bounce"
// timeline on mount (Kevin pass 3): rev 0→100 accelerating into the ceiling →
// bounce OFF 100 (a quick recoil dip + partial rebound, no hold) → fall back
// down past the real score (undershoot) → settle UP to the actual number.
// Built as explicit keyframed segments over one rAF loop (no animation
// library); the readout ticks in sync; the loop is cancelled on unmount and
// the score input is clamped to finite 0–100 (spec Codex fix 7).
// prefers-reduced-motion (via matchMedia): final state immediately. Arc color
// tracks the CURRENT needle value (red <80, amber 80–94, green ≥95).
import { useEffect, useRef, useState } from 'react'

const SWEEP_DEG = 240
const START_DEG = 150 // 150° → 390°: opening faces down

// Slam-and-bounce timeline (ms). No hold at the top — the bounce replaces it.
const REV_MS = 720      // 0 → 100, accelerating into the ceiling
const DIP_MS = 120      // 100 → recoil trough (the "bounce off 100")
const REBOUND_MS = 130  // trough → partial rebound before gravity wins
const FALL_MS = 470     // rebound → undershoot below the target
const SETTLE_MS = 340   // undershoot → rest on the actual score
// Bounce/undershoot depths, in score points.
const BOUNCE_DEPTH = 11 // how far the needle recoils below 100 on impact
const BOUNCE_RETURN = 4 // how far below 100 the rebound peaks before the fall
const UNDERSHOOT = 7    // how far below the target the fall dips before settling

const CX = 120
const CY = 120
const R = 92
const STROKE = 18
const ZONE_R = R + STROKE / 2 + 8 // outer danger-zone band radius
const TICK_OUTER = R - STROKE / 2 - 2
const TICK_INNER = R - STROKE / 2 - 9

function clampScore(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null
  return Math.min(100, Math.max(0, v))
}

// Grade thresholds shared with SectionCard.gradeForScore (kept as literals —
// this is a client leaf; do not import server modules here). Bands: ≥95 green,
// 80–94 amber, <80 red.
const AMBER_MIN = 80
const GREEN_MIN = 95
function gaugeColor(v: number): string {
  if (v >= GREEN_MIN) return '#16a34a' // green-600
  if (v >= AMBER_MIN) return '#d97706' // amber-600
  return '#dc2626' // red-600
}

function easeInCubic(p: number): number {
  return p * p * p
}
function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}
function easeInOutSine(p: number): number {
  return -(Math.cos(Math.PI * p) - 1) / 2
}

// One leg of the timeline: interpolate `from`→`to` over `dur` ms with `ease`.
type Segment = { dur: number; from: number; to: number; ease: (p: number) => number }

// The slam-and-bounce keyframe legs for a given clamped target.
function buildSegments(target: number): Segment[] {
  const trough = 100 - BOUNCE_DEPTH
  const rebound = 100 - BOUNCE_RETURN
  const undershoot = Math.max(0, target - UNDERSHOOT)
  return [
    { dur: REV_MS, from: 0, to: 100, ease: easeInCubic }, // slam into 100
    { dur: DIP_MS, from: 100, to: trough, ease: easeOutCubic }, // recoil off the ceiling
    { dur: REBOUND_MS, from: trough, to: rebound, ease: easeOutCubic }, // partial rebound
    { dur: FALL_MS, from: rebound, to: undershoot, ease: easeInOutSine }, // fall back, past the target
    { dur: SETTLE_MS, from: undershoot, to: target, ease: easeOutCubic }, // settle up onto the score
  ]
}

function polar(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

// Sweep angle for a 0–100 score value.
function degFor(value: number): number {
  return START_DEG + (SWEEP_DEG * value) / 100
}

function arcPath(fromDeg: number, toDeg: number, r: number = R): string {
  const from = polar(fromDeg, r)
  const to = polar(toDeg, r)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
}

// Outer danger-zone band: red 0–80, amber 80–95, green 95–100. Always visible
// (dimmed) so the "how far into the red" story reads at a glance.
const ZONES = [
  { from: 0, to: AMBER_MIN, color: '#dc2626' },
  { from: AMBER_MIN, to: GREEN_MIN, color: '#d97706' },
  { from: GREEN_MIN, to: 100, color: '#16a34a' },
]
const TICKS = Array.from({ length: 11 }, (_, i) => i * 10)

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
    const segments = buildSegments(target)
    const total = segments.reduce((sum, s) => sum + s.dur, 0)
    const startedAt = performance.now()
    const tick = (now: number) => {
      const t = now - startedAt
      if (t >= total) {
        setDisplay(target)
        return // timeline done — stop scheduling
      }
      let acc = 0
      let v = target
      for (const s of segments) {
        if (t < acc + s.dur) {
          v = s.from + (s.to - s.from) * s.ease((t - acc) / s.dur)
          break
        }
        acc += s.dur
      }
      setDisplay(Math.min(100, Math.max(0, v)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  const value = display
  const angle = degFor(value ?? 0)
  const color = value === null ? '#9ca3af' : gaugeColor(value)

  // Kite needle: sharp tip toward the arc, short counterweight tail past the
  // hub, base straddling the pivot. Reads as a real gauge pointer.
  const rad = (angle * Math.PI) / 180
  const perp = { x: -Math.sin(rad), y: Math.cos(rad) }
  const HALF_W = 5.5
  const tip = polar(angle, R - STROKE / 2 - 5)
  const tail = polar(angle + 180, 18)
  const baseL = { x: CX + perp.x * HALF_W, y: CY + perp.y * HALF_W }
  const baseR = { x: CX - perp.x * HALF_W, y: CY - perp.y * HALF_W }
  const needlePoints = `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${baseL.x.toFixed(2)},${baseL.y.toFixed(2)} ${tail.x.toFixed(2)},${tail.y.toFixed(2)} ${baseR.x.toFixed(2)},${baseR.y.toFixed(2)}`

  return (
    <div className="flex flex-col items-center" role="img" aria-label={value === null ? 'Overall score not available' : `Overall score ${Math.round(value)} out of 100`}>
      <svg viewBox="0 0 240 214" className="w-64 sm:w-72">
        <defs>
          <filter id="gauge-needle-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* outer danger-zone band (dimmed) — always visible */}
        {ZONES.map((z) => (
          <path
            key={z.from}
            d={arcPath(degFor(z.from), degFor(z.to), ZONE_R)}
            fill="none"
            stroke={z.color}
            strokeOpacity={0.35}
            strokeWidth={4}
          />
        ))}

        {/* main track */}
        <path d={arcPath(START_DEG, START_DEG + SWEEP_DEG)} fill="none" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth={STROKE} strokeLinecap="round" />

        {/* value arc */}
        {value !== null && value > 0 && (
          <path d={arcPath(START_DEG, angle)} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
        )}

        {/* tick marks */}
        {TICKS.map((t) => {
          const a = degFor(t)
          const o = polar(a, TICK_OUTER)
          const i = polar(a, TICK_INNER)
          return (
            <line key={t} x1={o.x} y1={o.y} x2={i.x} y2={i.y} stroke="currentColor" className="text-navy/25 dark:text-white/25" strokeWidth={t % 50 === 0 ? 2 : 1} strokeLinecap="round" />
          )
        })}

        {/* needle */}
        {value !== null && (
          <g filter="url(#gauge-needle-shadow)">
            <polygon points={needlePoints} fill={color} />
            <circle cx={CX} cy={CY} r={9} fill="currentColor" className="text-navy dark:text-white" />
            <circle cx={CX} cy={CY} r={4.5} fill={color} />
          </g>
        )}

        {/* readout */}
        <text x={CX} y={CY + 50} textAnchor="middle" className="font-heading fill-current text-navy dark:text-white" fontSize="48" fontWeight="800">
          {value === null ? '—' : Math.round(value)}
        </text>
        {value !== null && (
          <text x={CX} y={CY + 70} textAnchor="middle" className="font-body fill-current text-navy/50 dark:text-white/50" fontSize="12">
            out of 100
          </text>
        )}
      </svg>
      <p className="mt-1 text-[13px] font-body text-navy/60 dark:text-white/60 text-center">
        Overall score — average of the audit areas below.
      </p>
    </div>
  )
}
