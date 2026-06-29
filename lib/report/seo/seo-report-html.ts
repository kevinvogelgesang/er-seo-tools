// lib/report/seo/seo-report-html.ts
//
// Pure branded HTML builder for SEO Performance Reports.
// No Prisma, no network — receives SeoReportData, returns a self-contained
// HTML document suitable for page.setContent() → page.pdf().
//
// Conventions (mirrors C4 report-html.ts):
//   • Every dynamic string goes through escapeHtml / escapeAttr.
//   • Inline CSS only — no external assets.
//   • Brand colors hard-coded to the navy/orange palette.
//   • @page Letter, printBackground: true.
//   • Charts via lib/report/seo/charts.ts (lineChartSvg / donutSvg).
//   • Gap flags drive section omission — gapped sources render a labeled
//     "unavailable" block instead of their charts/tables/donuts.

import { escapeHtml, escapeAttr } from '../escape'
import { lineChartSvg, donutSvg } from './charts'
import type { SeoReportData, SeoScorecardRow } from './report-data'

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

// Palette extracted from the VirtualAdviser analytics dashboard (Mantine-based).
const BRAND = {
  navy: '#15457d', // sidebar / cover chrome
  navyDeep: '#0f3057', // darker navy
  blue: '#0b6dc7', // primary accent — KPI numbers, links
  blueMid: '#1e60a4', // chart blue
  teal: '#67c7c5',
  green: '#40c057',
  pink: '#fd5881',
  orange: '#f59f00', // accent only (not primary)
  deltaUp: '#12b886', // favorable change
  deltaDown: '#fa5252', // unfavorable change
  page: '#f8f9fa', // app background behind cards
  card: '#ffffff',
  border: '#dee2e6',
  grid: '#e0e0e0',
  text: '#212529',
  heading: '#343a40',
  muted: '#868e96',
  axisLabel: '#6b7280',
}

// ---------------------------------------------------------------------------
// Inline CSS
// ---------------------------------------------------------------------------

const FONT_STACK = `-apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: Letter; margin: 0.4in; }
  body { font-family: ${FONT_STACK}; color: ${BRAND.text}; font-size: 12px; line-height: 1.45; background: ${BRAND.page}; }
  /* Section headings — uppercase, tracked, muted-dark (dashboard card titles) */
  h2 { color: ${BRAND.heading}; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px; }
  h3 { color: ${BRAND.heading}; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 6px; }
  a { color: ${BRAND.blue}; word-break: break-all; }

  /* Cover — navy chrome + blue accent rule (mirrors the dashboard's navy sidebar) */
  .cover { background: ${BRAND.navy}; color: #ffffff; padding: 16px 28px 14px; border-bottom: 4px solid ${BRAND.blue}; }
  .cover-top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
  .wordmark { font-size: 11px; font-weight: 700; letter-spacing: 0.3em; color: #9ec5ec; }
  .cover h1 { font-size: 17px; margin: 4px 0 6px; color: #ffffff; font-weight: 600; }
  .cover-ident { font-size: 14px; color: #ffffff; font-weight: 600; }
  .cover-ident .cover-domain { color: #9ec5ec; font-weight: 400; }
  .cover-meta { font-size: 10.5px; color: #c2cfde; margin-top: 3px; }

  /* Section chrome — white cards, hairline border, 4px radius, no shadow */
  .section { margin: 16px 24px; }
  .card { page-break-inside: avoid; background: ${BRAND.card}; border: 1px solid ${BRAND.border}; border-radius: 4px; padding: 14px 16px; margin: 16px 24px; }

  /* Scorecard grid — uppercase muted label, bold blue value, colored delta */
  .sc-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .sc-tile { flex: 1 1 130px; min-width: 120px; background: ${BRAND.card}; border: 1px solid ${BRAND.border}; border-radius: 4px; padding: 12px; }
  .sc-label { font-size: 9px; color: ${BRAND.muted}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; font-weight: 600; }
  .sc-value { font-size: 26px; font-weight: 700; color: ${BRAND.blue}; line-height: 1.05; }
  .sc-delta { font-size: 11px; font-weight: 500; margin-top: 5px; }
  .delta-up { color: ${BRAND.deltaUp}; }
  .delta-down { color: ${BRAND.deltaDown}; }
  .delta-neutral { color: ${BRAND.muted}; }

  /* Charts */
  .chart-wrap { margin-top: 6px; }
  .chart-legend { display: flex; gap: 16px; font-size: 10px; color: ${BRAND.axisLabel}; margin: 2px 0 4px; flex-wrap: wrap; }
  .chart-legend .ln { display: inline-flex; align-items: center; gap: 5px; }
  .chart-legend .swatch { width: 14px; border-top: 3px solid #000; display: inline-block; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e9ecef; }
  th { color: ${BRAND.muted}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; border-bottom: 1px solid ${BRAND.border}; }
  td.num, th.num { text-align: right; }
  td.url { word-break: break-all; }
  tbody tr:nth-child(even) { background: ${BRAND.page}; }

  /* Donuts */
  .donut-row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .donut-block { flex: 0 0 auto; }
  .donut-legend { margin-top: 8px; font-size: 10px; min-width: 180px; }
  .donut-legend li { list-style: none; margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .donut-legend .legend-value { margin-left: auto; color: ${BRAND.axisLabel}; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Gap blocks */
  .gap-block { background: #fff3bf; border: 1px solid #f59f00; border-radius: 4px; padding: 10px 14px; color: #846100; font-size: 11px; margin: 16px 24px; }

  /* Footer */
  .footer-note { margin: 24px; padding-top: 10px; border-top: 1px solid ${BRAND.border}; font-size: 9px; color: ${BRAND.muted}; }

  /* Print */
  @media print {
    .card, .donut-block { page-break-inside: avoid; }
    .section { page-break-inside: avoid; }
  }
`

// ---------------------------------------------------------------------------
// Donut palette — enough colors for each slice
// ---------------------------------------------------------------------------

// Channel-category series palette read from the dashboard's stacked-area chart.
const DONUT_COLORS = [
  BRAND.blueMid, // #1e60a4
  BRAND.teal, // #67c7c5
  BRAND.green, // #40c057
  BRAND.pink, // #fd5881
  BRAND.orange, // #f59f00
  BRAND.blue, // #0b6dc7
  '#7048e8', // violet
  '#15aabf', // cyan
]

// Stroke color for the previous-period (comparison) line series (Mantine gray.5).
const PREV_COLOR = '#adb5bd'

// ---------------------------------------------------------------------------
// Shared chart legend (current vs previous period)
// ---------------------------------------------------------------------------

function seriesLegend(
  currentColor: string,
  currentLabel: string,
  prevLabel: string,
): string {
  return `
  <div class="chart-legend">
    <span class="ln"><span class="swatch" style="border-top-color:${escapeAttr(currentColor)}"></span>${escapeHtml(currentLabel)}</span>
    <span class="ln"><span class="swatch" style="border-top-color:${PREV_COLOR}"></span>${escapeHtml(prevLabel)}</span>
  </div>`
}

// ---------------------------------------------------------------------------
// Delta rendering helpers
// ---------------------------------------------------------------------------

function deltaHtml(sc: SeoScorecardRow): string {
  if (sc.delta === null) {
    return '<div class="sc-delta delta-neutral">—</div>'
  }
  const pct = (sc.delta * 100).toFixed(1)
  if (sc.deltaGood === true) {
    return `<div class="sc-delta delta-up">▲ ${pct}%</div>`
  }
  if (sc.deltaGood === false) {
    return `<div class="sc-delta delta-down">▼ ${pct}%</div>`
  }
  // delta exists but good=null (unusual; render neutral)
  const sign = sc.delta >= 0 ? '+' : ''
  return `<div class="sc-delta delta-neutral">${sign}${pct}%</div>`
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function coverSection(data: SeoReportData): string {
  const prepared = data.operator
    ? ` &nbsp;·&nbsp; Prepared by ${escapeHtml(data.operator)}`
    : ''
  return `
<header class="cover">
  <div class="cover-top">
    <div class="wordmark">ENROLLMENT RESOURCES</div>
    <div class="cover-meta">Generated ${escapeHtml(data.generatedAt)}${prepared}</div>
  </div>
  <h1>SEO Performance Report</h1>
  <div class="cover-ident">${escapeHtml(data.clientName)} <span class="cover-domain">· ${escapeHtml(data.domain)}</span></div>
  <div class="cover-meta">${escapeHtml(data.periodLabel)} &nbsp;vs&nbsp; ${escapeHtml(data.comparisonLabel)}</div>
</header>`
}

function scorecardSection(data: SeoReportData): string {
  const tiles = data.scorecards
    .map(
      (sc) => `
    <div class="sc-tile">
      <div class="sc-label">${escapeHtml(sc.label)}</div>
      <div class="sc-value">${escapeHtml(sc.value)}</div>
      ${deltaHtml(sc)}
    </div>`,
    )
    .join('')
  return `
<div class="card">
  <h2>Performance Scorecards</h2>
  <div class="sc-grid">${tiles}
  </div>
</div>`
}

// GA4 charts + tables — omitted when gaps.ga4

function sessionsChartSection(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  const svg = lineChartSvg(
    data.sessionsSeries.map((p) => p.value),
    data.sessionsSeriesPrev.map((p) => p.value),
    {
      width: 600,
      height: 170,
      color: BRAND.blue,
      prevColor: PREV_COLOR,
      xLabels: data.sessionsSeries.map((p) => p.date),
      yLabel: 'Sessions',
    },
  )
  return `
<div class="card">
  <h2>Sessions over Time</h2>
  ${seriesLegend(BRAND.blue, data.periodLabel, data.comparisonLabel)}
  <div class="chart-wrap">${svg}</div>
</div>`
}

function landingPagesSection(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  if (data.landingPages.length === 0) return ''
  const rows = data.landingPages
    .map(
      (p) => `
      <tr>
        <td class="url">${escapeHtml(p.path)}</td>
        <td class="num">${escapeHtml(String(p.sessions))}</td>
        <td class="num">${escapeHtml(String(p.keyEvents))}</td>
      </tr>`,
    )
    .join('')
  return `
<div class="card">
  <h2>Landing Page Sessions</h2>
  <table>
    <thead>
      <tr><th>Landing Page</th><th class="num">Sessions</th><th class="num">Key Events</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</div>`
}

function citiesSection(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  if (data.cities.length === 0) return ''
  const rows = data.cities
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.city)}</td>
        <td class="num">${escapeHtml(String(c.sessions))}</td>
        <td class="num">${escapeHtml(String(c.keyEvents))}</td>
      </tr>`,
    )
    .join('')
  return `
<div class="card">
  <h2>Sessions by Location</h2>
  <table>
    <thead>
      <tr><th>City</th><th class="num">Sessions</th><th class="num">Key Events</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</div>`
}

/**
 * Build a labeled donut block. Each legend row shows the slice label, its
 * session count, and its share of the total as a percentage.
 */
function donutBlock(
  title: string,
  items: { label: string; sessions: number }[],
): string {
  const slices = items.map((s, i) => ({
    label: s.label,
    value: s.sessions,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const svg = donutSvg(slices, { size: 120, strokeWidth: 28 })
  const legend = slices
    .map((s) => {
      const count = s.value.toLocaleString('en-US')
      const pct = total > 0 ? ` (${((s.value / total) * 100).toFixed(1)}%)` : ''
      return `<li><span class="legend-dot" style="background:${escapeAttr(s.color)}"></span><span class="legend-label">${escapeHtml(s.label)}</span><span class="legend-value">${escapeHtml(count)}${escapeHtml(pct)}</span></li>`
    })
    .join('')
  return `
<div class="donut-block">
  <h3>${escapeHtml(title)}</h3>
  ${svg}
  <ul class="donut-legend">${legend}</ul>
</div>`
}

function newVsReturningDonut(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  return donutBlock('New vs Returning', data.newVsReturning)
}

function devicesDonut(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  return donutBlock('Device Category', data.devices)
}

function donutsSection(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  const nvr = newVsReturningDonut(data)
  const dev = devicesDonut(data)
  if (!nvr && !dev) return ''
  return `
<div class="card">
  <h2>Audience Breakdown</h2>
  <div class="donut-row">
    ${nvr}
    ${dev}
  </div>
</div>`
}

// GSC charts + tables — omitted when gaps.gsc

function gscChartSection(data: SeoReportData): string {
  if (data.gaps.gsc) return ''
  const clicksSvg = lineChartSvg(
    data.clicksSeries.map((p) => p.value),
    data.clicksSeriesPrev.map((p) => p.value),
    {
      width: 600,
      height: 140,
      color: BRAND.blue,
      prevColor: PREV_COLOR,
      xLabels: data.clicksSeries.map((p) => p.date),
      yLabel: 'Clicks',
    },
  )
  const impSvg = lineChartSvg(
    data.impressionsSeries.map((p) => p.value),
    data.impressionsSeriesPrev.map((p) => p.value),
    {
      width: 600,
      height: 140,
      color: BRAND.blueMid,
      prevColor: PREV_COLOR,
      xLabels: data.impressionsSeries.map((p) => p.date),
      yLabel: 'Impressions',
    },
  )
  const posSvg = lineChartSvg(
    data.positionSeries.map((p) => p.value),
    data.positionSeriesPrev.map((p) => p.value),
    {
      width: 600,
      height: 140,
      color: '#2f9e9b',
      prevColor: PREV_COLOR,
      xLabels: data.positionSeries.map((p) => p.date),
      yLabel: 'Avg Position',
    },
  )
  return `
<div class="card">
  <h2>Clicks / Impressions / Position over Time</h2>
  ${seriesLegend(BRAND.blue, data.periodLabel, data.comparisonLabel)}
  <h3>Clicks</h3>
  <div class="chart-wrap">${clicksSvg}</div>
  <h3 style="margin-top:12px">Impressions</h3>
  <div class="chart-wrap">${impSvg}</div>
  <h3 style="margin-top:12px">Avg Position (lower is better)</h3>
  <div class="chart-wrap">${posSvg}</div>
</div>`
}

function queriesSection(data: SeoReportData): string {
  if (data.gaps.gsc) return ''
  if (data.queries.length === 0) return ''
  const rows = data.queries
    .map(
      (q) => `
      <tr>
        <td>${escapeHtml(q.query)}</td>
        <td class="num">${escapeHtml(q.position.toFixed(1))}</td>
        <td class="num">${q.positionPrev !== null ? escapeHtml(q.positionPrev.toFixed(1)) : '—'}</td>
      </tr>`,
    )
    .join('')
  return `
<div class="card">
  <h2>Top Queries</h2>
  <table>
    <thead>
      <tr><th>Query</th><th class="num">Avg Position</th><th class="num">Prev Position</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</div>`
}

// Gap blocks

function ga4GapBlock(data: SeoReportData): string {
  if (!data.gaps.ga4) return ''
  return `<div class="gap-block">GA4 data unavailable for this period. Sessions, landing pages, cities, and audience data could not be retrieved.</div>`
}

function gscGapBlock(data: SeoReportData): string {
  if (!data.gaps.gsc) return ''
  return `<div class="gap-block">Search Console (GSC) data unavailable for this period. Clicks, impressions, position, and queries could not be retrieved.</div>`
}

function prospectsGapBlock(data: SeoReportData): string {
  if (!data.gaps.prospects) return ''
  return `<div class="gap-block">Prospects data unavailable for this period. Prospect counts require manual entry or a connected CRM source.</div>`
}

function footerSection(): string {
  return `<div class="footer-note">Data sources: GA4 / Search Console / CRM &nbsp;·&nbsp; Generated by Enrollment Resources SEO Tools</div>`
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildSeoReportHtml(data: SeoReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>SEO Performance Report — ${escapeHtml(data.clientName)} — ${escapeHtml(data.periodLabel)}</title>
<style>${STYLE}</style>
</head>
<body>
${coverSection(data)}
${ga4GapBlock(data)}
${gscGapBlock(data)}
${prospectsGapBlock(data)}
${scorecardSection(data)}
${sessionsChartSection(data)}
${gscChartSection(data)}
${landingPagesSection(data)}
${queriesSection(data)}
${citiesSection(data)}
${donutsSection(data)}
${footerSection()}
</body>
</html>`
}
