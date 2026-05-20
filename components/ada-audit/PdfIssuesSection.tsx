'use client'

import { useState } from 'react'
import type { PdfIssue } from '@/lib/ada-audit/pdf-types'

interface PdfRow {
  url: string
  fileSize: number | null
  pageCount: number | null
  issues: PdfIssue[]
  scanError?: string | null
}

function formatBytes(b: number | null): string {
  if (b == null) return '?'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function plainTextForPdf(pdf: PdfRow): string {
  const filename = pdf.url.split('/').pop() ?? pdf.url
  const meta = `${formatBytes(pdf.fileSize)}, ${pdf.pageCount ?? '?'} pages`
  const head = `${filename}\n${pdf.url}\n${meta}`
  if (pdf.scanError) return `${head}\nScan failed: ${pdf.scanError}`
  if (pdf.issues.length === 0) return `${head}\nNo issues detected.`
  const lines = pdf.issues.flatMap((i) => [
    `  • ${i.title}`,
    `    ${i.description}`,
    `    Fix: ${i.remediation}`,
  ])
  return [head, ...lines].join('\n')
}

function htmlForPdf(pdf: PdfRow): string {
  const filename = pdf.url.split('/').pop() ?? pdf.url
  const meta = `${formatBytes(pdf.fileSize)}, ${pdf.pageCount ?? '?'} pages`
  const head =
    `<p style="margin:0 0 4px 0"><strong>${escapeHtml(filename)}</strong></p>` +
    `<p style="margin:0 0 4px 0"><a href="${escapeHtml(pdf.url)}">${escapeHtml(pdf.url)}</a></p>` +
    `<p style="margin:0 0 8px 0; color:#555">${escapeHtml(meta)}</p>`
  if (pdf.scanError) {
    return head + `<p style="margin:0 0 12px 0; color:#b00">Scan failed: ${escapeHtml(pdf.scanError)}</p>`
  }
  if (pdf.issues.length === 0) {
    return head + `<p style="margin:0 0 12px 0">No issues detected.</p>`
  }
  const items = pdf.issues
    .map(
      (i) =>
        `<li style="margin-bottom:6px"><strong>${escapeHtml(i.title)}</strong> — ${escapeHtml(i.description)} <em>Fix:</em> ${escapeHtml(i.remediation)}</li>`,
    )
    .join('')
  return head + `<ul style="margin:0 0 12px 18px; padding:0">${items}</ul>`
}

async function writeRichClipboard(html: string, text: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      return
    }
  } catch {
    // fall through to plain-text fallback
  }
  await navigator.clipboard.writeText(text)
}

interface Props {
  pdfs: PdfRow[]
}

export default function PdfIssuesSection({ pdfs }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (pdfs.length === 0) return null

  const copyAll = async () => {
    const text = pdfs.map(plainTextForPdf).join('\n\n')
    const html =
      `<div>` +
      `<p style="margin:0 0 12px 0"><strong>PDF accessibility issues</strong> (${pdfs.length} files)</p>` +
      pdfs.map(htmlForPdf).join('') +
      `</div>`
    await writeRichClipboard(html, text)
    setCopied('__all')
    setTimeout(() => setCopied(null), 1500)
  }

  const copyOne = async (pdf: PdfRow) => {
    await writeRichClipboard(htmlForPdf(pdf), plainTextForPdf(pdf))
    setCopied(pdf.url)
    setTimeout(() => setCopied(null), 1500)
  }

  const toggle = (url: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const totalIssues = pdfs.reduce((n, p) => n + p.issues.length, 0)
  const allExpanded = expanded.size === pdfs.length
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(pdfs.map((p) => p.url)))
  }

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
          PDFs Found <span className="text-navy/40 dark:text-white/40 font-normal">({pdfs.length} files, {totalIssues} issues)</span>
        </h2>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[12px] font-body font-semibold text-navy/60 dark:text-white/60 hover:underline"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            type="button"
            onClick={copyAll}
            className="text-[12px] font-body font-semibold text-orange hover:underline"
          >
            {copied === '__all' ? 'Copied!' : 'Copy all'}
          </button>
        </div>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-navy-border">
        {pdfs.map((pdf) => {
          const filename = pdf.url.split('/').pop() ?? pdf.url
          const isOpen = expanded.has(pdf.url)
          const issueCount = pdf.scanError ? 1 : pdf.issues.length
          return (
            <div key={pdf.url}>
              <button
                type="button"
                onClick={() => toggle(pdf.url)}
                className="w-full flex items-center gap-3 px-6 py-3 text-left hover:bg-gray-50 dark:hover:bg-navy-deep/50 transition-colors"
                aria-expanded={isOpen}
              >
                <span
                  className={`text-navy/40 dark:text-white/40 text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                >
                  ▶
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-body font-semibold text-[14px] text-navy dark:text-white truncate">
                    {filename}
                  </div>
                  <div className="text-[11px] font-body text-navy/40 dark:text-white/40 truncate">
                    {formatBytes(pdf.fileSize)} · {pdf.pageCount ?? '?'} pages
                  </div>
                </div>
                <span
                  className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    pdf.scanError
                      ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                      : issueCount === 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                  }`}
                >
                  {pdf.scanError ? 'scan failed' : `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`}
                </span>
              </button>

              {isOpen && (
                <div className="px-6 pb-4 pl-12 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={pdf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-navy/50 dark:text-white/50 hover:underline truncate min-w-0"
                    >
                      {pdf.url}
                    </a>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void copyOne(pdf)
                      }}
                      className="text-[11px] font-body font-semibold text-orange hover:underline whitespace-nowrap"
                    >
                      {copied === pdf.url ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  {pdf.scanError ? (
                    <p className="text-[12px] text-red-600 dark:text-red-400">Scan failed: {pdf.scanError}</p>
                  ) : pdf.issues.length === 0 ? (
                    <p className="text-[12px] text-navy/60 dark:text-white/60">No issues detected.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {pdf.issues.map((i, idx) => (
                        <li key={`${i.code}-${idx}`} className="text-[12px] font-body text-navy dark:text-white">
                          <span className="font-semibold">{i.title}</span> — <span className="text-navy/60 dark:text-white/60">{i.description}</span> <span className="text-navy/50 dark:text-white/50 italic">Fix: {i.remediation}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
