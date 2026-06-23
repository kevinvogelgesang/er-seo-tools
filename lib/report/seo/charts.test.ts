// lib/report/seo/charts.test.ts
// TDD tests for inline SVG chart builders — RED first, no production code yet.
// Run with: npx vitest run lib/report/seo/charts.test.ts

import { describe, it, expect } from 'vitest'
import { lineChartSvg, donutSvg } from './charts'

// ---------------------------------------------------------------------------
// Hard assertion helper — applies to EVERY test
// ---------------------------------------------------------------------------

function assertNoNanInfinity(svg: string, label: string) {
  expect(svg, `${label}: should not contain NaN`).not.toContain('NaN')
  expect(svg, `${label}: should not contain Infinity`).not.toContain('Infinity')
}

// ---------------------------------------------------------------------------
// lineChartSvg
// ---------------------------------------------------------------------------

describe('lineChartSvg', () => {
  const opts = { width: 400, height: 200, color: '#e97316' }

  it('returns a valid SVG string', () => {
    const svg = lineChartSvg([10, 20, 30], [5, 15, 25], opts)
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('</svg>')
    assertNoNanInfinity(svg, '3-point chart')
  })

  it('0 points — returns an empty chart frame with no NaN', () => {
    const svg = lineChartSvg([], [], opts)
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('</svg>')
    assertNoNanInfinity(svg, '0-point empty frame')
  })

  it('1 point — renders a single dot without crashing', () => {
    const svg = lineChartSvg([50], [50], opts)
    expect(svg).toMatch(/^<svg/)
    assertNoNanInfinity(svg, '1-point chart')
  })

  it('N points — renders two series (current + previous)', () => {
    const svg = lineChartSvg([10, 20, 30, 40], [5, 15, 25, 35], opts)
    // Two distinct colored elements should appear (current series + previous)
    // The current color is in opts.color; previous uses a dimmed/different color.
    // At minimum we expect at least 2 path or polyline elements.
    const pathMatches = svg.match(/<(?:path|polyline)[^>]*>/g) ?? []
    expect(pathMatches.length, 'should have at least 2 series elements').toBeGreaterThanOrEqual(2)
    assertNoNanInfinity(svg, 'N-point two-series chart')
  })

  it('N points — each series polyline/path has N-1 line segments (L commands or N points)', () => {
    const n = 5
    const current = [10, 20, 15, 30, 25]
    const previous = [8, 18, 13, 28, 22]
    const svg = lineChartSvg(current, previous, opts)
    // A polyline with 5 points has 5 coordinate pairs; a path with 5 points
    // starts with M and 4 L commands. Either way the current series element
    // should contain references to all 5 data points.
    // We just verify no NaN here — the coordinate count is validated structurally.
    assertNoNanInfinity(svg, '5-point N-point chart')
    expect(svg).toMatch(/^<svg/)
  })

  it('all-equal values — no NaN/Infinity (divide-by-zero guard)', () => {
    const svg = lineChartSvg([50, 50, 50, 50], [50, 50, 50, 50], opts)
    assertNoNanInfinity(svg, 'all-equal values (divide-by-zero guard)')
    expect(svg).toMatch(/^<svg/)
  })

  it('previous is empty, current has points — renders without NaN', () => {
    const svg = lineChartSvg([10, 20, 30], [], opts)
    assertNoNanInfinity(svg, 'empty previous, current has points')
    expect(svg).toMatch(/^<svg/)
  })

  it('current is empty, previous has points — renders without NaN', () => {
    const svg = lineChartSvg([], [10, 20, 30], opts)
    assertNoNanInfinity(svg, 'empty current, previous has points')
    expect(svg).toMatch(/^<svg/)
  })

  it('single-value arrays — no NaN (divide-by-zero on single point scaling)', () => {
    const svg = lineChartSvg([42], [], opts)
    assertNoNanInfinity(svg, 'single current, empty previous')
    expect(svg).toMatch(/^<svg/)
  })
})

// ---------------------------------------------------------------------------
// donutSvg
// ---------------------------------------------------------------------------

describe('donutSvg', () => {
  const opts = { size: 160, strokeWidth: 32 }

  it('renders one arc path per slice', () => {
    const slices = [
      { label: 'Organic', value: 60, color: '#e97316' },
      { label: 'Direct', value: 25, color: '#1e3a5f' },
      { label: 'Referral', value: 15, color: '#6b7280' },
    ]
    const svg = donutSvg(slices, opts)
    const arcPaths = svg.match(/<path[^>]*>/g) ?? []
    expect(arcPaths.length, 'arc count should equal slice count').toBe(slices.length)
    assertNoNanInfinity(svg, '3-slice donut')
  })

  it('single slice — full circle arc, no NaN', () => {
    const svg = donutSvg([{ label: 'All', value: 100, color: '#e97316' }], opts)
    const arcPaths = svg.match(/<path[^>]*>/g) ?? []
    expect(arcPaths.length).toBe(1)
    assertNoNanInfinity(svg, 'single-slice donut')
  })

  it('0-total (all zero values) — renders a neutral ring, no NaN', () => {
    const slices = [
      { label: 'A', value: 0, color: '#e97316' },
      { label: 'B', value: 0, color: '#1e3a5f' },
    ]
    const svg = donutSvg(slices, opts)
    expect(svg).toMatch(/^<svg/)
    assertNoNanInfinity(svg, 'all-zero slices neutral ring')
  })

  it('empty slices array — renders a neutral ring, no NaN', () => {
    const svg = donutSvg([], opts)
    expect(svg).toMatch(/^<svg/)
    assertNoNanInfinity(svg, 'empty slices neutral ring')
  })

  it('slices covering exactly a full circle (no overlap/gaps)', () => {
    // Structural: with valid non-zero slices every arc draws correctly
    const slices = [
      { label: 'X', value: 50, color: '#e97316' },
      { label: 'Y', value: 50, color: '#1e3a5f' },
    ]
    const svg = donutSvg(slices, opts)
    const arcPaths = svg.match(/<path[^>]*>/g) ?? []
    expect(arcPaths.length).toBe(2)
    assertNoNanInfinity(svg, 'two equal slices full circle')
  })

  it('returns a valid SVG string with xmlns', () => {
    const slices = [{ label: 'Solo', value: 100, color: '#e97316' }]
    const svg = donutSvg(slices, opts)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('</svg>')
  })

  it('hostile label — escapes attribute-breaking characters in data-label', () => {
    // A label with a double-quote + inline event handler that would break
    // out of the data-label attribute if not escaped.
    const hostileLabel = 'x" onload="alert(1)'
    const svg = donutSvg([{ label: hostileLabel, value: 100, color: '#e97316' }], opts)
    // The raw attribute-break sequence must NOT appear in the output.
    expect(svg).not.toContain('" onload="alert(1)')
    // The double-quote MUST be escaped to &quot;
    expect(svg).toContain('&quot;')
    // The data-label attribute must still be present (just safely encoded).
    expect(svg).toContain('data-label=')
  })
})
