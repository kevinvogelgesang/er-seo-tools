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

function plainTextForPdf(pdf: PdfRow): string {
  const filename = pdf.url.split('/').pop() ?? pdf.url
  const head = `${filename} — ${pdf.url} (${formatBytes(pdf.fileSize)}, ${pdf.pageCount ?? '?'} pages)`
  if (pdf.scanError) return `${head}\n• Scan failed: ${pdf.scanError}`
  const lines = pdf.issues.map((i) => `• ${i.title} — ${i.description} Fix: ${i.remediation}`)
  return [head, ...lines].join('\n')
}

interface Props {
  pdfs: PdfRow[]
}

export default function PdfIssuesSection({ pdfs }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  if (pdfs.length === 0) return null

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const totalIssues = pdfs.reduce((n, p) => n + p.issues.length, 0)
  const copyAll = pdfs.map(plainTextForPdf).join('\n\n')

  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
          PDFs Found <span className="text-navy/40 dark:text-white/40 font-normal">({pdfs.length} files, {totalIssues} issues)</span>
        </h2>
        <button
          type="button"
          onClick={() => copy(copyAll, '__all')}
          className="text-[12px] font-body font-semibold text-orange hover:underline"
        >
          {copied === '__all' ? 'Copied!' : 'Copy all'}
        </button>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-navy-border">
        {pdfs.map((pdf) => {
          const filename = pdf.url.split('/').pop() ?? pdf.url
          const block = plainTextForPdf(pdf)
          return (
            <div key={pdf.url} className="px-6 py-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-body font-semibold text-[14px] text-navy dark:text-white truncate">{filename}</div>
                  <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-navy/40 dark:text-white/40 hover:underline truncate block">{pdf.url}</a>
                </div>
                <button
                  type="button"
                  onClick={() => copy(block, pdf.url)}
                  className="text-[11px] font-body font-semibold text-orange hover:underline whitespace-nowrap"
                >
                  {copied === pdf.url ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {!pdf.scanError && (
                <div className="text-[11px] font-body text-navy/40 dark:text-white/40">
                  {formatBytes(pdf.fileSize)} · {pdf.pageCount ?? '?'} pages
                </div>
              )}
              {pdf.scanError ? (
                <p className="text-[12px] text-red-600 dark:text-red-400">Scan failed: {pdf.scanError}</p>
              ) : (
                <ul className="space-y-1">
                  {pdf.issues.map((i, idx) => (
                    <li key={`${i.code}-${idx}`} className="text-[12px] font-body text-navy dark:text-white">
                      <span className="font-semibold">{i.title}</span> — <span className="text-navy/60 dark:text-white/60">{i.description}</span> <span className="text-navy/50 dark:text-white/50">Fix: {i.remediation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
