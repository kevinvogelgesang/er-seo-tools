// lib/report/seo/charts.ts
// Pure inline-SVG chart builders for SEO performance reports.
// No external dependencies — deterministic string output, no Date, no randomness.
// Matches the C4 sparkline idiom in lib/report/report-html.ts.

// ---------------------------------------------------------------------------
// lineChartSvg
// ---------------------------------------------------------------------------

export interface LineChartOpts {
  width: number
  height: number
  /** Primary/current series stroke color (hex or CSS color string) */
  color: string
}

/**
 * Render two overlaid line series (current + previous period) as inline SVG.
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
  const PAD_X = 14
  const PAD_Y = 10
  const plotW = W - PAD_X * 2
  const plotH = H - PAD_Y * 2

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
    if (range === 0) return PAD_Y + plotH / 2 // flat mid-line
    return PAD_Y + (1 - (v - dataMin) / range) * plotH
  }

  // Map an index within an array of length n → x coordinate.
  const toX = (i: number, n: number): number => {
    if (n === 1) return W / 2 // center single point
    return PAD_X + (i / (n - 1)) * plotW
  }

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
  const prevSeries = buildSeries(previous, '#9ca3af', 1.5, 0.6)
  // Current series: full color, thicker stroke, rendered on top.
  const currSeries = buildSeries(current, color, 2, 1)

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${prevSeries}${currSeries}</svg>`
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
    return `<path d="${d}" fill="none" stroke="${slice.color}" stroke-width="${strokeWidth}" stroke-linecap="butt" data-label="${slice.label}"/>`
  })

  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    paths.join('') +
    `</svg>`
  )
}
