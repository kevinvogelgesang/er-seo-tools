export interface SitemapIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface SitemapParseResult {
  valid: boolean;
  urlCount: number;
  issues: SitemapIssue[];
  sampleUrls: string[];
  hasLastmod: boolean;
  hasChangefreq: boolean;
  hasPriority: boolean;
  isSitemapIndex: boolean;
}

function extractTagValues(content: string, tag: string): string[] {
  const results: string[] = []
  const openTag = `<${tag}`
  const closeTag = `</${tag}>`
  let searchFrom = 0

  while (true) {
    const openIdx = content.indexOf(openTag, searchFrom)
    if (openIdx === -1) break

    // Find the end of the opening tag (handles self-closing and attributes)
    const tagEnd = content.indexOf('>', openIdx)
    if (tagEnd === -1) break

    // Check for self-closing
    if (content[tagEnd - 1] === '/') {
      searchFrom = tagEnd + 1
      continue
    }

    const closeIdx = content.indexOf(closeTag, tagEnd)
    if (closeIdx === -1) {
      searchFrom = tagEnd + 1
      continue
    }

    const value = content.slice(tagEnd + 1, closeIdx).trim()
    results.push(value)
    searchFrom = closeIdx + closeTag.length
  }

  return results
}

function countOccurrences(content: string, substring: string): number {
  let count = 0
  let pos = 0
  while (true) {
    const idx = content.indexOf(substring, pos)
    if (idx === -1) break
    count++
    pos = idx + substring.length
  }
  return count
}

export function parseSitemapXml(content: string): SitemapParseResult {
  const issues: SitemapIssue[] = []
  const trimmed = content.trim()

  // Detect type
  const isSitemapIndex = trimmed.includes('<sitemapindex')
  const isUrlset = trimmed.includes('<urlset')

  if (!isSitemapIndex && !isUrlset) {
    issues.push({ severity: 'error', message: 'Missing <urlset> or <sitemapindex> root element — this does not appear to be a valid sitemap.' })
    return {
      valid: false,
      urlCount: 0,
      issues,
      sampleUrls: [],
      hasLastmod: false,
      hasChangefreq: false,
      hasPriority: false,
      isSitemapIndex: false,
    }
  }

  // Count <loc> tags
  const locValues = extractTagValues(content, 'loc')
  const urlCount = locValues.length

  // Extract first 10 as sample
  const sampleUrls = locValues.slice(0, 10)

  // Check for metadata fields
  const hasLastmod = content.includes('<lastmod')
  const hasChangefreq = content.includes('<changefreq')
  const hasPriority = content.includes('<priority')

  // Validate URL count
  if (urlCount > 50000) {
    issues.push({ severity: 'error', message: `URL count (${urlCount.toLocaleString()}) exceeds the 50,000 URL sitemap limit. Split into multiple sitemaps referenced from a sitemap index.` })
  } else if (urlCount > 45000) {
    issues.push({ severity: 'warning', message: `URL count (${urlCount.toLocaleString()}) is approaching the 50,000 URL limit. Consider splitting soon.` })
  }

  if (urlCount === 0) {
    issues.push({ severity: 'warning', message: 'No <loc> elements found — the sitemap appears to be empty.' })
  }

  // Check for lastmod absence
  if (!hasLastmod && !isSitemapIndex) {
    issues.push({ severity: 'info', message: 'No <lastmod> dates found. Adding last-modified dates helps search engines prioritize recrawling.' })
  }

  // Check for URLs with spaces
  const urlsWithSpaces = sampleUrls.filter((u) => u.includes(' '))
  if (urlsWithSpaces.length > 0) {
    issues.push({ severity: 'warning', message: `Found URLs containing spaces (e.g. "${urlsWithSpaces[0]}"). Spaces must be percent-encoded as %20.` })
  }

  // Also check all loc values (beyond sample) for spaces
  if (urlsWithSpaces.length === 0) {
    const allSpaceUrls = locValues.filter((u) => u.includes(' '))
    if (allSpaceUrls.length > 0) {
      issues.push({ severity: 'warning', message: `Found ${allSpaceUrls.length} URL(s) with spaces beyond the first 10. Spaces must be percent-encoded as %20.` })
    }
  }

  // Check for duplicate <loc> values
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const loc of locValues) {
    if (seen.has(loc)) duplicates.add(loc)
    else seen.add(loc)
  }
  if (duplicates.size > 0) {
    issues.push({ severity: 'warning', message: `Found ${duplicates.size} duplicate URL(s) in the sitemap. Remove duplicates to avoid confusing crawlers.` })
  }

  // Check for mismatched tag counts (basic malformation check)
  const openUrlCount = countOccurrences(content, '<url>')
  const closeUrlCount = countOccurrences(content, '</url>')
  if (openUrlCount !== closeUrlCount && !isSitemapIndex) {
    issues.push({ severity: 'error', message: `Mismatched <url> tags: ${openUrlCount} opening vs ${closeUrlCount} closing. The XML may be malformed.` })
  }

  // Check for non-HTTPS URLs
  const httpUrls = locValues.filter((u) => u.startsWith('http://'))
  if (httpUrls.length > 0) {
    issues.push({ severity: 'warning', message: `Found ${httpUrls.length} URL(s) using HTTP instead of HTTPS. Use HTTPS for all sitemap URLs.` })
  }

  // If sitemap index, note child sitemap count
  if (isSitemapIndex) {
    issues.push({ severity: 'info', message: `This is a sitemap index file pointing to ${urlCount} child sitemap(s).` })
  }

  const hasErrors = issues.some((i) => i.severity === 'error')

  return {
    valid: !hasErrors,
    urlCount,
    issues,
    sampleUrls,
    hasLastmod,
    hasChangefreq,
    hasPriority,
    isSitemapIndex,
  }
}

// ── Crawl-side XML helpers (moved from lib/ada-audit/sitemap-crawler.ts) ────
// NOTE: parseSitemapXml above intentionally keeps its own extractTagValues —
// it validates the raw document (counts every <loc>), while these helpers
// feed the crawl/discovery path (scoped to <url>/<sitemap> blocks).

function extractLocs(xml: string, tagPattern: RegExp): string[] {
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(xml)) !== null) {
    // Strip CDATA wrappers and whitespace
    const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/, '$1').trim()
    if (raw) urls.push(raw)
  }
  return urls
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml)
}

/** Page URLs from a plain urlset sitemap (`<url>…<loc>` pairs). */
export function extractPageLocs(xml: string): string[] {
  return extractLocs(xml, /<url>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
}

/** Child sitemap URLs from a sitemapindex (`<sitemap>…<loc>` pairs). */
export function extractChildSitemapLocs(xml: string): string[] {
  return extractLocs(xml, /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi)
}
