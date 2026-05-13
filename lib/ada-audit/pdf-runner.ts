// lib/ada-audit/pdf-runner.ts
//
// Lightweight PDF accessibility scanner. Uses pdfjs-dist (Node legacy build)
// to inspect metadata, structure tree, and extractable text. No Chrome, no
// veraPDF — fast and pure-Node.

import { safeFetch, readResponseBytesWithLimit } from '@/lib/security/safe-url'
import type { PdfIssue, PdfIssueCode, PdfScanResult } from './pdf-types'

const LARGE_FILE_BYTES = 10 * 1024 * 1024
const MANY_PAGES = 50
const PDF_MAX_BYTES = 25 * 1024 * 1024 // hard cap for SSRF-safe fetch; > LARGE_FILE_BYTES so we still scan + flag rather than refuse

const ISSUE_TEMPLATES: Record<PdfIssueCode, Omit<PdfIssue, 'code'>> = {
  'not-tagged': {
    severity: 'high',
    title: 'Not tagged for screen readers',
    description:
      'PDF lacks a structure tree, so assistive technology reads content in random order.',
    remediation:
      'Re-export from source with "Tagged PDF" enabled, or open in Acrobat Pro → Prepare for Accessibility.',
  },
  'no-title': {
    severity: 'medium',
    title: 'No document title set',
    description:
      'Title metadata is empty, so screen readers announce the filename instead of a meaningful title.',
    remediation:
      'In Acrobat, File → Properties → Description → set Title. Also enable "Display title bar" in Initial View.',
  },
  'no-language': {
    severity: 'medium',
    title: 'No language declared',
    description:
      'Document language metadata is missing, so screen readers cannot select the correct voice/pronunciation.',
    remediation:
      'In Acrobat, File → Properties → Advanced → set Language. For multilingual PDFs, set per-section language in the structure tree.',
  },
  'image-only': {
    severity: 'high',
    title: 'No extractable text — appears to be a scanned image',
    description:
      'Screen readers cannot read images of text. The PDF contains no real text layer.',
    remediation:
      'Run OCR (Acrobat Pro → Recognize Text) to add a real text layer, then verify reading order.',
  },
  'at-restricted': {
    severity: 'high',
    title: 'Encrypted with assistive technology access restricted',
    description:
      'PDF security settings block screen readers from extracting content.',
    remediation:
      'In Acrobat → Properties → Security, change to "No Security" or enable "Allow text access for screen readers".',
  },
  'large-file': {
    severity: 'low',
    title: 'Large file (over 10 MB)',
    description: 'Large PDFs are slow to download and can time out on mobile.',
    remediation:
      'Compress images, split into multiple smaller PDFs, or offer an HTML alternative.',
  },
  'many-pages': {
    severity: 'low',
    title: 'Over 50 pages',
    description: 'Long PDFs are hard to navigate with a screen reader.',
    remediation:
      'Consider offering an HTML version of the content, or splitting into chapter-sized files.',
  },
}

function make(code: PdfIssueCode): PdfIssue {
  return { code, ...ISSUE_TEMPLATES[code] }
}

export async function scanPdfBuffer(
  buf: Buffer,
  normalizedUrl: string
): Promise<PdfScanResult> {
  // pdfjs-dist v4+ legacy build is the Node-compatible one
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const data = new Uint8Array(buf)
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableWorker: true,
  }).promise

  const issues: PdfIssue[] = []
  const fileSize = buf.byteLength
  const pageCount = doc.numPages

  // Structure tree
  let hasStructTree = false
  try {
    const tree = await doc.getStructTree?.()
    hasStructTree = !!tree
  } catch {
    /* not tagged */
  }
  if (!hasStructTree) issues.push(make('not-tagged'))

  // Metadata
  const meta = await doc.getMetadata().catch(() => null)
  const info = meta?.info ?? {}
  if (!info.Title || String(info.Title).trim() === '') issues.push(make('no-title'))
  if (!info.Language && !info.Lang) issues.push(make('no-language'))

  // Text extraction across all pages
  let totalChars = 0
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    totalChars += (tc.items ?? []).reduce(
      (n: number, it: { str?: string }) => n + (it.str?.length ?? 0),
      0
    )
    if (totalChars > 0) break
  }
  if (totalChars === 0) issues.push(make('image-only'))

  if (fileSize > LARGE_FILE_BYTES) issues.push(make('large-file'))
  if (pageCount > MANY_PAGES) issues.push(make('many-pages'))

  return { url: normalizedUrl, fileSize, pageCount, issues }
}

/** Fetch + scan. Wraps scanPdfBuffer with SSRF-safe HTTP fetch and error capture. */
export async function scanPdfUrl(url: string): Promise<PdfScanResult> {
  try {
    // Use safeFetch (validates initial URL + every redirect via assertSafeHttpUrl)
    // then readResponseBytesWithLimit enforces the byte cap.
    const { response } = await safeFetch(url, undefined, { maxRedirects: 5 })
    if (response.status >= 400) {
      return {
        url,
        fileSize: null,
        pageCount: null,
        issues: [],
        scanError: `HTTP ${response.status}`,
      }
    }
    const { bytes, truncated } = await readResponseBytesWithLimit(response, PDF_MAX_BYTES)
    if (truncated) {
      return {
        url,
        fileSize: null,
        pageCount: null,
        issues: [],
        scanError: `PDF exceeds ${PDF_MAX_BYTES}-byte cap`,
      }
    }
    return await scanPdfBuffer(Buffer.from(bytes), url)
  } catch (e) {
    return {
      url,
      fileSize: null,
      pageCount: null,
      issues: [],
      scanError: (e as Error).message,
    }
  }
}
