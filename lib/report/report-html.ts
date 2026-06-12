// lib/report/report-html.ts
//
// Pure HTML builder for the branded site-audit PDF report (C4). No prisma —
// everything arrives via SiteReportData (assembled in report-data.ts) and is
// rendered through page.setContent() + page.pdf() in the report-render job.
// EVERY dynamic string goes through escapeHtml/escapeAttr (Codex spec fix).
// Impact strings render verbatim ('unknown' included — neutral color, never
// coerced into the four axe impacts).

import { escapeHtml, escapeAttr } from './escape'
import type { AuditScorecard, ArchivedCounts } from '@/lib/ada-audit/types'
import type { InstanceDiff } from '@/lib/services/findings-shared'
import type { ScorePoint } from '@/lib/services/scorecard-shared'

export interface ReportTopIssue {
  ruleId: string
  impact: string          // exact axe impact, may be 'unknown' — render verbatim
  help: string | null
  helpUrl: string | null
  pageCount: number
  sampleUrls: string[]    // ≤5
  nodeSamples: string[]   // ≤2 capped html samples
  screenshot: string | null // data URI or null
}

export interface ReportWorstPage {
  url: string
  critical: number
  serious: number
  moderate: number
  minor: number
  total: number
}

export interface SiteReportData {
  siteAuditId: string
  domain: string
  clientName: string | null
  wcagLevel: string
  auditDate: string        // ISO — audit completedAt ?? createdAt
  generatedAt: string      // ISO — render time
  requestedBy: string | null
  score: number
  compliant: boolean
  archived: boolean
  pagesTotal: number
  pagesError: number
  aggregate: AuditScorecard
  archivedCounts: ArchivedCounts | null
  trend: ScorePoint[]      // ascending, ≤12, includes this audit's point
  diff: InstanceDiff | null
  previousCompletedAt: string | null
  topIssues: ReportTopIssue[]   // ≤10
  worstPages: ReportWorstPage[] // ≤50
  issuePagesTotal: number
  pdfsTotal: number
  pdfsWithIssues: number
}

const BRAND = { navy: '#1c2d4a', navyDeep: '#0f1d30', orange: '#f5a623', light: '#f7f8fa' }

const IMPACT_COLOR: Record<string, string> = {
  critical: '#dc2626', serious: '#ea580c', moderate: '#ca8a04', minor: '#2563eb',
}
const impactColor = (impact: string) => IMPACT_COLOR[impact] ?? '#6b7280'

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const impactRank = (impact: string) => IMPACT_RANK[impact] ?? 4

const fmtDate = (iso: string) => iso.slice(0, 10)

const wcagLabel = (level: string) =>
  level === 'wcag22aa' ? 'WCAG 2.2 AA + Best Practices' : 'WCAG 2.1 AA'

/** Nullable count cell — archived audits render "—", never a literal 0 (C3 contract). */
const dash = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n))

// ── Inline-SVG sparkline ─────────────────────────────────────────────────────

function sparklineSvg(points: ScorePoint[]): string {
  if (points.length === 0) return ''
  const W = 480, H = 80, PAD_X = 14, TOP = 10, BOTTOM = 24
  const plotW = W - PAD_X * 2
  const plotH = H - TOP - BOTTOM
  const x = (i: number) =>
    points.length === 1 ? W / 2 : PAD_X + (i / (points.length - 1)) * plotW
  const y = (score: number) =>
    TOP + (1 - Math.min(100, Math.max(0, score)) / 100) * plotH

  const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
  const polyline = points.length >= 2
    ? `<polyline fill="none" stroke="${BRAND.orange}" stroke-width="2" points="${coords.join(' ')}"/>`
    : ''
  const circles = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="3" fill="${BRAND.navy}"/>`)
    .join('')
  const first = points[0]
  const last = points[points.length - 1]
  const labels =
    `<text x="${PAD_X}" y="${H - 6}" font-size="9" fill="#6b7280">${escapeHtml(fmtDate(first.date))} · ${first.score}</text>` +
    (points.length >= 2
      ? `<text x="${W - PAD_X}" y="${H - 6}" font-size="9" fill="#6b7280" text-anchor="end">${escapeHtml(fmtDate(last.date))} · ${last.score}</text>`
      : '')
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${polyline}${circles}${labels}</svg>`
}

// ── Section builders ─────────────────────────────────────────────────────────

function coverSection(data: SiteReportData): string {
  const client = data.clientName
    ? `<div class="cover-client">${escapeHtml(data.clientName)}</div>`
    : ''
  const operator = data.requestedBy
    ? `<div class="cover-meta">Requested by ${escapeHtml(data.requestedBy)}</div>`
    : ''
  return `
<header class="cover">
  <div class="wordmark">ENROLLMENT RESOURCES</div>
  <div class="wordmark-rule"></div>
  <h1>Website Accessibility Audit Report</h1>
  <div class="cover-domain">${escapeHtml(data.domain)}</div>
  ${client}
  <div class="cover-meta">${escapeHtml(wcagLabel(data.wcagLevel))}</div>
  <div class="cover-meta">Audit date: ${escapeHtml(fmtDate(data.auditDate))} · Report generated: ${escapeHtml(fmtDate(data.generatedAt))}</div>
  ${operator}
</header>`
}

function summarySection(data: SiteReportData): string {
  const passed = data.archived ? dash(data.archivedCounts?.passed ?? null) : String(data.aggregate.passed)
  const incomplete = data.archived ? dash(data.archivedCounts?.incomplete ?? null) : String(data.aggregate.incomplete)
  const pill = data.compliant
    ? '<span class="pill pill-ok">Compliant</span>'
    : '<span class="pill pill-bad">Non-compliant</span>'
  const tile = (label: string, value: string, color?: string) => `
    <div class="tile">
      <div class="tile-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="tile-label">${label}</div>
    </div>`
  return `
<section class="card">
  <h2>Executive summary</h2>
  <div class="score-row">
    <div class="score-big">${data.score}</div>
    <div>${pill}<div class="score-sub">Accessibility score (0–100)</div></div>
  </div>
  <div class="tiles">
    ${tile('Pages scanned', String(data.pagesTotal))}
    ${tile('Pages with issues', String(data.issuePagesTotal))}
    ${tile('Critical', String(data.aggregate.critical), impactColor('critical'))}
    ${tile('Serious', String(data.aggregate.serious), impactColor('serious'))}
    ${tile('Moderate', String(data.aggregate.moderate), impactColor('moderate'))}
    ${tile('Minor', String(data.aggregate.minor), impactColor('minor'))}
    ${tile('Passed checks', passed)}
    ${tile('Incomplete checks', incomplete)}
  </div>
</section>`
}

function trendSection(data: SiteReportData): string {
  if (data.trend.length === 0) return ''
  return `
<section class="card">
  <h2>Score trend</h2>
  ${sparklineSvg(data.trend)}
</section>`
}

function changesSection(data: SiteReportData): string {
  const diff = data.diff
  if (diff === null) return ''
  const since = data.previousCompletedAt
    ? ` (previous audit ${escapeHtml(fmtDate(data.previousCompletedAt))})`
    : ''
  const rows = diff.rules.slice(0, 10).map((r) => `
      <tr>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.severity)}</td>
        <td class="num">${r.newTotal}</td>
        <td class="num">${r.resolvedTotal}</td>
      </tr>`).join('')
  return `
<section class="card">
  <h2>Changes since previous audit${since}</h2>
  <p>
    New: <strong>${diff.newCount}</strong>
    (${diff.regressedCount} regressed, ${diff.newPageCount} on new pages) ·
    Resolved: <strong>${diff.resolvedCount}</strong> ·
    Not rescanned: ${diff.notRescannedCount} ·
    Unchanged: ${diff.unchangedCount}
  </p>
  ${rows ? `<table>
    <thead><tr><th>Rule</th><th>Severity</th><th class="num">New</th><th class="num">Resolved</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>` : ''}
</section>`
}

function topIssuesSection(data: SiteReportData): string {
  if (data.topIssues.length === 0) return ''
  const cards = data.topIssues.map((issue, i) => {
    const urls = issue.sampleUrls
      .map((u) => `<li><a href="${escapeAttr(u)}">${escapeHtml(u)}</a></li>`)
      .join('')
    const samples = issue.nodeSamples
      .map((s) => `<code class="node-sample">${escapeHtml(s)}</code>`)
      .join('')
    const helpLink = issue.helpUrl
      ? ` <a class="help-link" href="${escapeAttr(issue.helpUrl)}">Learn more</a>`
      : ''
    // Archived audits ship no screenshots by contract (child blobs pruned).
    const shot = !data.archived && issue.screenshot
      ? `<img class="shot" src="${escapeAttr(issue.screenshot)}" alt="Screenshot of a failing ${escapeAttr(issue.ruleId)} element"/>`
      : ''
    return `
  <div class="card issue">
    <h3><span class="rank">#${i + 1}</span> ${escapeHtml(issue.ruleId)}
      <span class="chip" style="background:${impactColor(issue.impact)}">${escapeHtml(issue.impact)}</span></h3>
    <p>${escapeHtml(issue.help ?? issue.ruleId)}${helpLink}</p>
    <p class="issue-meta">${issue.pageCount} page${issue.pageCount === 1 ? '' : 's'} affected</p>
    ${urls ? `<ul class="sample-urls">${urls}</ul>` : ''}
    ${samples}
    ${shot}
  </div>`
  }).join('')
  return `
<section>
  <h2>Top issues</h2>
  ${cards}
</section>`
}

const GROUP_LABEL: Record<number, string> = {
  0: 'Fix critical issues first',
  1: 'Then address serious issues',
  2: 'Then address moderate issues',
  3: 'Then address minor issues',
  4: 'Also review',
}

function remediationSection(data: SiteReportData): string {
  if (data.topIssues.length === 0) return ''
  const groups = new Map<number, ReportTopIssue[]>()
  for (const issue of data.topIssues) {
    const rank = impactRank(issue.impact)
    const list = groups.get(rank) ?? []
    list.push(issue)
    groups.set(rank, list)
  }
  const blocks = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, issues]) => `
    <h3>${escapeHtml(GROUP_LABEL[rank] ?? GROUP_LABEL[4])}</h3>
    <ol>${issues.map((i) =>
      `<li>${escapeHtml(i.ruleId)} — ${i.pageCount} page${i.pageCount === 1 ? '' : 's'}</li>`).join('')}
    </ol>`)
    .join('')
  return `
<section class="card">
  <h2>Remediation priorities</h2>
  ${blocks}
</section>`
}

function worstPagesSection(data: SiteReportData): string {
  if (data.worstPages.length === 0) return ''
  const rows = data.worstPages.map((p) => `
      <tr>
        <td class="url">${escapeHtml(p.url)}</td>
        <td class="num">${p.critical}</td>
        <td class="num">${p.serious}</td>
        <td class="num">${p.moderate}</td>
        <td class="num">${p.minor}</td>
        <td class="num">${p.total}</td>
      </tr>`).join('')
  const more = data.issuePagesTotal > data.worstPages.length
    ? `<p class="more">…and ${data.issuePagesTotal - data.worstPages.length} more pages with issues.</p>`
    : ''
  return `
<section class="appendix">
  <h2>Appendix: pages with the most issues</h2>
  <table>
    <thead><tr><th>Page</th><th class="num">Critical</th><th class="num">Serious</th><th class="num">Moderate</th><th class="num">Minor</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${more}
</section>`
}

function pdfNoteSection(data: SiteReportData): string {
  if (data.pdfsTotal === 0) return ''
  return `
<section class="card">
  <h2>PDF accessibility</h2>
  <p>${data.pdfsTotal} linked PDF${data.pdfsTotal === 1 ? '' : 's'} scanned, ${data.pdfsWithIssues} with accessibility issues.</p>
</section>`
}

function archivedNoteSection(data: SiteReportData): string {
  if (!data.archived) return ''
  return `
<div class="archived-note">
  This audit's full per-page detail was pruned after 90 days; violations shown
  are exact, but passed/incomplete counts and screenshots are no longer available.
</div>`
}

// ── Document ─────────────────────────────────────────────────────────────────

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; font-size: 12px; line-height: 1.45; }
  h2 { color: ${BRAND.navy}; font-size: 16px; margin: 0 0 8px; }
  h3 { font-size: 13px; margin: 10px 0 4px; color: ${BRAND.navyDeep}; }
  a { color: ${BRAND.navy}; word-break: break-all; }
  .cover { background: ${BRAND.navy}; color: #ffffff; padding: 36px 32px 28px; border-bottom: 6px solid ${BRAND.orange}; }
  .wordmark { font-size: 14px; font-weight: 700; letter-spacing: 0.35em; color: #ffffff; }
  .wordmark-rule { width: 64px; height: 3px; background: ${BRAND.orange}; margin: 8px 0 20px; }
  .cover h1 { font-size: 24px; margin: 0 0 10px; color: #ffffff; }
  .cover-domain { font-size: 18px; color: ${BRAND.orange}; margin-bottom: 4px; }
  .cover-client { font-size: 14px; margin-bottom: 4px; }
  .cover-meta { font-size: 11px; color: #d1d5db; margin-top: 2px; }
  section, .archived-note { margin: 16px 24px; }
  .card { page-break-inside: avoid; background: ${BRAND.light}; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; }
  .score-row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
  .score-big { font-size: 44px; font-weight: 700; color: ${BRAND.navyDeep}; }
  .score-sub { font-size: 10px; color: #6b7280; margin-top: 4px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; color: #ffffff; font-size: 11px; font-weight: 600; }
  .pill-ok { background: #16a34a; }
  .pill-bad { background: #dc2626; }
  .tiles { display: flex; flex-wrap: wrap; gap: 8px; }
  .tile { flex: 1 1 100px; min-width: 100px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; text-align: center; }
  .tile-value { font-size: 18px; font-weight: 700; color: ${BRAND.navyDeep}; }
  .tile-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .issue { margin-bottom: 12px; }
  .rank { color: ${BRAND.orange}; font-weight: 700; margin-right: 4px; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; color: #ffffff; font-size: 10px; font-weight: 600; margin-left: 6px; vertical-align: middle; }
  .issue-meta { color: #6b7280; font-size: 11px; }
  .sample-urls { margin: 6px 0; padding-left: 18px; }
  .node-sample { display: block; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 4px; padding: 6px 8px; margin: 4px 0; font-size: 10px; white-space: pre-wrap; word-break: break-all; }
  .shot { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; margin-top: 6px; }
  .help-link { font-size: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  th { color: ${BRAND.navy}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; }
  td.url { word-break: break-all; }
  .appendix { page-break-before: always; }
  .more { color: #6b7280; }
  .archived-note { page-break-inside: avoid; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 10px 14px; color: #92400e; }
  .footer-note { margin: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #6b7280; }
`

export function buildSiteReportHtml(data: SiteReportData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(`Accessibility Audit Report — ${data.domain}`)}</title>
<style>${STYLE}</style>
</head>
<body>
${coverSection(data)}
${summarySection(data)}
${trendSection(data)}
${changesSection(data)}
${topIssuesSection(data)}
${remediationSection(data)}
${pdfNoteSection(data)}
${archivedNoteSection(data)}
${worstPagesSection(data)}
<div class="footer-note">Generated by Enrollment Resources SEO Tools — automated axe-core scan; not a legal conformance statement.</div>
</body>
</html>`
}
