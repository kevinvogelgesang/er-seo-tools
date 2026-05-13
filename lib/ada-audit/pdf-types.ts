// lib/ada-audit/pdf-types.ts
export type PdfIssueSeverity = 'high' | 'medium' | 'low'

export type PdfIssueCode =
  | 'not-tagged'
  | 'no-title'
  | 'no-language'
  | 'image-only'
  | 'at-restricted'
  | 'large-file'
  | 'many-pages'

export interface PdfIssue {
  code: PdfIssueCode
  severity: PdfIssueSeverity
  title: string
  description: string
  remediation: string
}

export interface PdfScanResult {
  url: string                 // normalized
  fileSize: number | null
  pageCount: number | null
  issues: PdfIssue[]
  scanError?: string
}
