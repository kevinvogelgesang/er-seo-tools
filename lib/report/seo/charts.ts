// lib/report/seo/charts.ts
// Pure inline-SVG chart builders for SEO performance reports.
// No external dependencies — deterministic string output, no Date, no randomness.
// Matches the C4 sparkline idiom in lib/report/report-html.ts.

import { escapeAttr } from '@/lib/report/escape'

// ---------------------------------------------------------------------------
// lineChartSvg
// ---------------------------------------------------------------------------

export interface LineChartOpts {
  width: number
  height: number
  /** Primary/current series stroke color (hex or CSS color string) */
  color: string
  /** Stroke color for the previous-period (comparison) series. Default: '#9ca3af' */
  prevColor?: string
  /** Axis / gridline color. Default: '#d1d5db' */
  axisColor?: string
  /** Tick-label text color. Default: '#6b7280' */
  labelColor?: string
  /** X-axis category labels (e.g. dates), aligned to the CURRENT series indices. */
  xLabels?: string[]
  /** Y-axis title rendered rotated at the far left. */
  yLabel?: string
  /** Formats a y-axis tick value into a label string. Default: compact number. */
  formatY?: (v: number) => string
}

// Compact, deterministic numeric label (no locale, no Date).
// 1234 → "1.2k", 2_500_000 → "2.5M", 8.27 → "8.3", 42 → "42".
function compactNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(1)
}

// Shorten a YYYY-MM-DD date label to MM-DD; pass anything else through verbatim.
function shortDate(label: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label
}

/**
 * Render two overlaid line series (current + previous period) as inline SVG,
 * with a labeled value axis (left), a labeled category axis (bottom), and
 * horizontal gridlines.
 *
 * Edge-case guarantees:
 * - 0 points → empty chart frame, NO NaN in output.
 * - 1 point → single dot, no crash.
 * - All-equal values → divide-by-zero guard: renders a flat mid-line.
 * - Either series may be empty independently; the other still renders.
 */
export function lineChartSvg(
  current: number[],
  previous: number[],
  opts: LineChartOpts,
): string {
  const { width: W, height: H, color } = opts
  const prevColor = opts.prevColor ?? '#9ca3af'
  const axisColor = opts.axisColor ?? '#e0e0e0'
  const labelColor = opts.labelColor ?? '#6b7280'
  const formatY = opts.formatY ?? compactNum
  const xLabels = opts.xLabels ?? []
  const yLabel = opts.yLabel

  // Padding reserves room for axis labels.
  const PAD_LEFT = yLabel ? 52 : 40
  const PAD_RIGHT = 14
  const PAD_TOP = 10
  const PAD_BOTTOM = 26

  const plotLeft = PAD_LEFT
  const plotRight = W - PAD_RIGHT
  const plotTop = PAD_TOP
  const plotBottom = H - PAD_BOTTOM
  const plotW = plotRight - plotLeft
  const plotH = plotBottom - plotTop

  // Collect all values to compute a shared scale across both series.
  const allValues = [...current, ...previous]

  // Empty frame when both series have no data.
  if (allValues.length === 0) {
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"></svg>`
  }

  const dataMin = Math.min(...allValues)
  const dataMax = Math.max(...allValues)
  const range = dataMax - dataMin

  // Map a value → y coordinate. Guard divide-by-zero when range === 0.
  const toY = (v: number): number => {
    if (range === 0) return plotTop + plotH / 2 // flat mid-line
    return plotTop + (1 - (v - dataMin) / range) * plotH
  }

  // Map an index within an array of length n → x coordinate.
  const toX = (i: number, n: number): number => {
    if (n === 1) return plotLeft + plotW / 2 // center single point
    return plotLeft + (i / (n - 1)) * plotW
  }

  // ── Y-axis gridlines + tick labels ───────────────────────────────────────
  const NUM_Y_TICKS = 4
  let gridlines = ''
  let yTickLabels = ''
  const tickValues =
    range === 0
      ? [dataMin]
      : Array.from(
          { length: NUM_Y_TICKS },
          (_, t) => dataMin + (range * t) / (NUM_Y_TICKS - 1),
        )
  for (const tv of tickValues) {
    const y = toY(tv).toFixed(1)
    gridlines += `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${axisColor}" stroke-width="0.5" opacity="0.6"/>`
    yTickLabels += `<text x="${plotLeft - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="${labelColor}">${escapeAttr(formatY(tv))}</text>`
  }

  // ── Axis lines ────────────────────────────────────────────────────────────
  const axisLines =
    `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="${axisColor}" stroke-width="1"/>` +
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="${axisColor}" stroke-width="1"/>`

  // ── X-axis category labels (up to ~6 evenly spaced) ───────────────────────
  let xTickLabels = ''
  const n = current.length
  if (n > 0 && xLabels.length > 0) {
    const maxLabels = Math.min(6, n)
    const step = maxLabels <= 1 ? 1 : (n - 1) / (maxLabels - 1)
    const seen = new Set<number>()
    for (let k = 0; k < maxLabels; k++) {
      const i = Math.round(k * step)
      if (i < 0 || i >= n || seen.has(i) || i >= xLabels.length) continue
      seen.add(i)
      const x = toX(i, n)
      // Anchor edges inward so they don't clip the SVG bounds.
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
      xTickLabels += `<text x="${x.toFixed(1)}" y="${plotBottom + 12}" text-anchor="${anchor}" font-size="8" fill="${labelColor}">${escapeAttr(shortDate(xLabels[i]))}</text>`
    }
  }

  // ── Y-axis title (rotated) ────────────────────────────────────────────────
  const yAxisTitle = yLabel
    ? `<text x="12" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" font-size="8" fill="${labelColor}" transform="rotate(-90 12 ${((plotTop + plotBottom) / 2).toFixed(1)})">${escapeAttr(yLabel)}</text>`
    : ''

  // Build a polyline element for a series.
  const buildSeries = (
    values: number[],
    stroke: string,
    strokeWidth: number,
    opacity: number,
  ): string => {
    if (values.length === 0) return ''

    const coords = values
      .map((v, i) => `${toX(i, values.length).toFixed(1)},${toY(v).toFixed(1)}`)
      .join(' ')

    const circles = values
      .map(
        (v, i) =>
          `<circle cx="${toX(i, values.length).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="${stroke}" opacity="${opacity}"/>`,
      )
      .join('')

    const polyline =
      values.length >= 2
        ? `<polyline fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round" points="${coords}"/>`
        : ''

    return polyline + circles
  }

  // Previous series: dimmed, thinner stroke.
  const prevSeries = buildSeries(previous, prevColor, 1.5, 0.6)
  // Current series: full color, thicker stroke, rendered on top.
  const currSeries = buildSeries(current, color, 2, 1)

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${gridlines}${axisLines}${yTickLabels}${xTickLabels}${yAxisTitle}${prevSeries}${currSeries}</svg>`
}

// ---------------------------------------------------------------------------
// donutSvg
// ---------------------------------------------------------------------------

export interface DonutSlice {
  label: string
  value: number
  color: string
}

export interface DonutOpts {
  /** Overall size of the SVG square canvas (default: 160) */
  size: number
  /** Width of the donut ring stroke (default: 32) */
  strokeWidth: number
}

/**
 * Render a donut chart as inline SVG using stroke-dasharray arc technique.
 *
 * Each slice is a `<path>` arc element. The number of `<path>` elements
 * equals the number of non-empty slices (or 1 neutral ring on 0-total/empty).
 *
 * opts shape:
 *   { size: number; strokeWidth: number }
 *   size        — canvas side length (the SVG is square); radius derived as (size/2 - strokeWidth/2)
 *   strokeWidth — donut ring thickness
 *
 * Edge-case guarantees:
 * - 0-total (all values 0 or empty slices array) → neutral gray ring, NO NaN.
 */
export function donutSvg(slices: DonutSlice[], opts: DonutOpts): string {
  const { size, strokeWidth } = opts
  const cx = size / 2
  const cy = size / 2
  const r = cx - strokeWidth / 2

  // Neutral ring fallback (0-total or empty input).
  const neutralRing = (): string =>
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}"/>` +
    `</svg>`

  const total = slices.reduce((s, sl) => s + sl.value, 0)

  if (slices.length === 0 || total === 0) {
    return neutralRing()
  }

  // Arc helper: given a start angle (radians) and a sweep fraction [0,1],
  // return an SVG arc path `d` attribute string (large-arc-flag handled).
  const arcPath = (startAngle: number, fraction: number): string => {
    // Clamp fraction to [0, 1] to avoid degenerate arcs.
    const f = Math.max(0, Math.min(1, fraction))

    // Full circle: use two half-arcs (SVG can't draw a complete circle in one arc command).
    if (f >= 1) {
      const top = { x: cx, y: cy - r }
      const bot = { x: cx, y: cy + r }
      return (
        `M ${top.x.toFixed(3)} ${top.y.toFixed(3)} ` +
        `A ${r.toFixed(3)} ${r.toFixed(3)} 0 0 1 ${bot.x.toFixed(3)} ${bot.y.toFixed(3)} ` +
        `A ${r.toFixed(3)} ${r.toFixed(3)} 0 0 1 ${top.x.toFixed(3)} ${top.y.toFixed(3)}`
      )
    }

    const sweep = f * 2 * Math.PI
    const endAngle = startAngle + sweep

    // SVG convention: angle 0 = top (12 o'clock), clockwise.
    const sx = (cx + r * Math.sin(startAngle)).toFixed(3)
    const sy = (cy - r * Math.cos(startAngle)).toFixed(3)
    const ex = (cx + r * Math.sin(endAngle)).toFixed(3)
    const ey = (cy - r * Math.cos(endAngle)).toFixed(3)

    const largeArc = sweep > Math.PI ? 1 : 0

    return `M ${sx} ${sy} A ${r.toFixed(3)} ${r.toFixed(3)} 0 ${largeArc} 1 ${ex} ${ey}`
  }

  let angleCursor = 0
  const paths = slices.map((slice) => {
    const fraction = slice.value / total
    const d = arcPath(angleCursor, fraction)
    angleCursor += fraction * 2 * Math.PI
    return `<path d="${d}" fill="none" stroke="${slice.color}" stroke-width="${strokeWidth}" stroke-linecap="butt" data-label="${escapeAttr(slice.label)}"/>`
  })

  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    paths.join('') +
    `</svg>`
  )
}
