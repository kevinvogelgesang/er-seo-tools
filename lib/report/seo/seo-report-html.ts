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

const BRAND = {
  navy: '#1c2d4a',
  navyDeep: '#0f1d30',
  orange: '#f5a623',
  light: '#f7f8fa',
}

// ---------------------------------------------------------------------------
// Inline CSS
// ---------------------------------------------------------------------------

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: Letter; margin: 0.4in; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1f2937; font-size: 12px; line-height: 1.45; }
  h2 { color: ${BRAND.navy}; font-size: 15px; margin: 0 0 10px; }
  h3 { color: ${BRAND.navyDeep}; font-size: 12px; margin: 0 0 6px; }
  a { color: ${BRAND.navy}; word-break: break-all; }

  /* Cover */
  .cover { background: ${BRAND.navy}; color: #ffffff; padding: 36px 32px 28px; border-bottom: 6px solid ${BRAND.orange}; }
  .wordmark { font-size: 14px; font-weight: 700; letter-spacing: 0.35em; color: #ffffff; }
  .wordmark-rule { width: 64px; height: 3px; background: ${BRAND.orange}; margin: 8px 0 20px; }
  .cover h1 { font-size: 22px; margin: 0 0 10px; color: #ffffff; }
  .cover-domain { font-size: 16px; color: ${BRAND.orange}; margin-bottom: 4px; }
  .cover-client { font-size: 14px; margin-bottom: 4px; color: #ffffff; }
  .cover-meta { font-size: 11px; color: #d1d5db; margin-top: 2px; }

  /* Section chrome */
  .section { margin: 16px 24px; }
  .card { page-break-inside: avoid; background: ${BRAND.light}; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; margin: 16px 24px; }

  /* Scorecard grid */
  .sc-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .sc-tile { flex: 1 1 130px; min-width: 120px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
  .sc-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .sc-value { font-size: 20px; font-weight: 700; color: ${BRAND.navyDeep}; }
  .sc-delta { font-size: 10px; margin-top: 3px; }
  .delta-up { color: #16a34a; }
  .delta-down { color: #dc2626; }
  .delta-neutral { color: #6b7280; }

  /* Charts */
  .chart-wrap { margin-top: 8px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  th { color: ${BRAND.navy}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; }
  td.url { word-break: break-all; }

  /* Donuts */
  .donut-row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .donut-block { flex: 0 0 auto; }
  .donut-legend { margin-top: 8px; font-size: 10px; }
  .donut-legend li { list-style: none; margin-bottom: 3px; display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  /* Gap blocks */
  .gap-block { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 10px 14px; color: #92400e; font-size: 11px; margin: 16px 24px; }

  /* Footer */
  .footer-note { margin: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #6b7280; }

  /* Print */
  @media print {
    .card, .donut-block { page-break-inside: avoid; }
    .section { page-break-inside: avoid; }
  }
`

// ---------------------------------------------------------------------------
// Donut palette — enough colors for each slice
// ---------------------------------------------------------------------------

const DONUT_COLORS = [
  BRAND.orange,
  BRAND.navy,
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
]

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
  const operatorLine = data.operator
    ? `<div class="cover-meta">Prepared by ${escapeHtml(data.operator)}</div>`
    : ''
  return `
<header class="cover">
  <div class="wordmark">ENROLLMENT RESOURCES</div>
  <div class="wordmark-rule"></div>
  <h1>SEO Performance Report</h1>
  <div class="cover-domain">${escapeHtml(data.domain)}</div>
  <div class="cover-client">${escapeHtml(data.clientName)}</div>
  <div class="cover-meta">Period: ${escapeHtml(data.periodLabel)} &nbsp;·&nbsp; Comparison: ${escapeHtml(data.comparisonLabel)}</div>
  <div class="cover-meta">Generated: ${escapeHtml(data.generatedAt)}</div>
  ${operatorLine}
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
    { width: 600, height: 160, color: BRAND.orange },
  )
  return `
<div class="card">
  <h2>Sessions over Time</h2>
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

function newVsReturningDonut(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  const slices = data.newVsReturning.map((s, i) => ({
    label: s.label,
    value: s.sessions,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))
  const svg = donutSvg(slices, { size: 120, strokeWidth: 28 })
  const legend = slices
    .map(
      (s) =>
        `<li><span class="legend-dot" style="background:${escapeAttr(s.color)}"></span>${escapeHtml(s.label)}</li>`,
    )
    .join('')
  return `
<div class="donut-block">
  <h3>New vs Returning</h3>
  ${svg}
  <ul class="donut-legend">${legend}</ul>
</div>`
}

function devicesDonut(data: SeoReportData): string {
  if (data.gaps.ga4) return ''
  const slices = data.devices.map((s, i) => ({
    label: s.label,
    value: s.sessions,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }))
  const svg = donutSvg(slices, { size: 120, strokeWidth: 28 })
  const legend = slices
    .map(
      (s) =>
        `<li><span class="legend-dot" style="background:${escapeAttr(s.color)}"></span>${escapeHtml(s.label)}</li>`,
    )
    .join('')
  return `
<div class="donut-block">
  <h3>Device Category</h3>
  ${svg}
  <ul class="donut-legend">${legend}</ul>
</div>`
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
    { width: 600, height: 120, color: BRAND.orange },
  )
  const impSvg = lineChartSvg(
    data.impressionsSeries.map((p) => p.value),
    data.impressionsSeriesPrev.map((p) => p.value),
    { width: 600, height: 120, color: BRAND.navy },
  )
  const posSvg = lineChartSvg(
    data.positionSeries.map((p) => p.value),
    data.positionSeriesPrev.map((p) => p.value),
    { width: 600, height: 120, color: '#6b7280' },
  )
  return `
<div class="card">
  <h2>Clicks / Impressions / Position over Time</h2>
  <h3>Clicks</h3>
  <div class="chart-wrap">${clicksSvg}</div>
  <h3 style="margin-top:12px">Impressions</h3>
  <div class="chart-wrap">${impSvg}</div>
  <h3 style="margin-top:12px">Avg Position</h3>
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
<title>${escapeHtml(`SEO Performance Report — ${data.clientName} — ${data.periodLabel}`)}</title>
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
