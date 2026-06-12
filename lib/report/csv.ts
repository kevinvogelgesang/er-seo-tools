// lib/report/csv.ts
// Pure RFC-4180 CSV builder with Excel formula-injection neutralization
// (page URLs and axe help text are externally controlled — Codex spec fix #2).

/** Header-safe filename fragment: DB strings (domain) must never carry
 *  quotes/CRLF/path chars into Content-Disposition (Codex plan fix #1). */
export function safeFilenamePart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let s = value
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r\t]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [header.map(csvField).join(','), ...rows.map((r) => r.map(csvField).join(','))]
  return '﻿' + lines.join('\r\n')
}
