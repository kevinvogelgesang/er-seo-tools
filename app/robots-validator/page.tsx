'use client'

import { useState, useRef, useCallback } from 'react'
import {
  parseRobotsTxt,
  testUrlAgainstRobots,
  KNOWN_AI_BOTS,
  type RobotsParseResult,
  type RobotsIssue,
} from '@/lib/validators/robots.validator'
import { parseSitemapXml, type SitemapParseResult, type SitemapIssue } from '@/lib/validators/sitemap.validator'

// ─── Reference bot data ───────────────────────────────────────────────────────

const BOT_REFERENCE = [
  { name: 'Googlebot', agent: 'Googlebot', owner: 'Google', type: 'Search' },
  { name: 'Bingbot', agent: 'bingbot', owner: 'Microsoft', type: 'Search' },
  { name: 'Google-Extended', agent: 'Google-Extended', owner: 'Google', type: 'AI Training' },
  { name: 'GPTBot', agent: 'GPTBot', owner: 'OpenAI', type: 'AI Training' },
  { name: 'ChatGPT-User', agent: 'ChatGPT-User', owner: 'OpenAI', type: 'AI Browsing' },
  { name: 'ClaudeBot', agent: 'ClaudeBot', owner: 'Anthropic', type: 'AI Training' },
  { name: 'anthropic-ai', agent: 'anthropic-ai', owner: 'Anthropic', type: 'AI Training' },
  { name: 'CCBot', agent: 'CCBot', owner: 'Common Crawl', type: 'Web Crawl' },
  { name: 'PerplexityBot', agent: 'PerplexityBot', owner: 'Perplexity AI', type: 'AI Search' },
  { name: 'Amazonbot', agent: 'Amazonbot', owner: 'Amazon', type: 'AI / Alexa' },
  { name: 'Bytespider', agent: 'Bytespider', owner: 'ByteDance/TikTok', type: 'AI Training' },
  { name: 'FacebookBot', agent: 'FacebookBot', owner: 'Meta', type: 'Social / AI' },
  { name: 'Applebot', agent: 'Applebot', owner: 'Apple', type: 'Search / Siri' },
  { name: 'DuckDuckBot', agent: 'DuckDuckBot', owner: 'DuckDuckGo', type: 'Search' },
]

// ─── Small shared UI primitives ───────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  const map = {
    error:   'bg-red-100 text-red-700 border border-red-200',
    warning: 'bg-amber-100 text-amber-700 border border-amber-200',
    info:    'bg-blue-100 text-blue-700 border border-blue-200',
  }
  return (
    <span className={`inline-block text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${map[severity]}`}>
      {severity}
    </span>
  )
}

function IssueList({ issues }: { issues: Array<RobotsIssue | SitemapIssue> }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
        <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
        <span className="text-[13px] font-body font-semibold">No issues found</span>
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
          <SeverityBadge severity={issue.severity} />
          <span className="text-[13px] font-body text-navy/80 leading-relaxed">{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
        <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center text-orange flex-shrink-0">
          {icon}
        </div>
        <h2 className="font-display font-bold text-[17px] text-navy">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="font-display font-semibold text-[13px] uppercase tracking-[0.12em] text-navy/50 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function MetaBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-body font-semibold border ${
      active
        ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-gray-50 text-gray-400 border-gray-200'
    }`}>
      {active
        ? <CheckCircleIcon className="w-3.5 h-3.5" />
        : <XCircleIcon className="w-3.5 h-3.5" />}
      {label}
    </div>
  )
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function RobotsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M12 11V7" />
      <circle cx="12" cy="5" r="2" />
      <path d="M8 15h.01M12 15h.01M16 15h.01" strokeWidth={2.5} />
    </svg>
  )
}

function SitemapIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18" opacity={0.3} />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="2" y="10" width="6" height="4" rx="1" />
      <rect x="16" y="10" width="6" height="4" rx="1" />
      <rect x="9" y="17" width="6" height="4" rx="1" />
      <path d="M12 7v3M5 14v3M19 14v3M12 14v3" />
    </svg>
  )
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a2 2 0 012 2v1h3a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h3V4a2 2 0 012-2z" />
      <circle cx="9" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 15c1 1 5 1 6 0" />
    </svg>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" />
    </svg>
  )
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

// ─── File upload helper ───────────────────────────────────────────────────────

function useFileUpload(onLoad: (content: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text === 'string') onLoad(text)
    }
    reader.readAsText(file)
  }, [onLoad])

  const openPicker = () => inputRef.current?.click()

  const inputEl = (
    <input
      ref={inputRef}
      type="file"
      className="hidden"
      accept=".txt,.xml,text/plain,text/xml,application/xml"
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) handleFile(file)
        // Reset so same file can be re-uploaded
        e.target.value = ''
      }}
    />
  )

  return { openPicker, inputEl }
}

// ─── Textarea + file upload combo ────────────────────────────────────────────

function InputArea({
  value,
  onChange,
  placeholder,
  label,
  rows = 12,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
  rows?: number
}) {
  const { openPicker, inputEl } = useFileUpload(onChange)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="font-body text-[13px] font-semibold text-navy/70">{label}</label>
        <button
          type="button"
          onClick={openPicker}
          className="inline-flex items-center gap-1.5 text-[12px] font-body font-semibold text-orange hover:text-orange/80 transition-colors"
        >
          <UploadIcon className="w-3.5 h-3.5" />
          Upload file
        </button>
      </div>
      {inputEl}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full font-mono text-[12px] text-navy bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange/50 resize-y placeholder:text-gray-400 leading-relaxed"
        spellCheck={false}
      />
    </div>
  )
}

// ─── Spinner icon ─────────────────────────────────────────────────────────────

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 2a10 10 0 0 1 10 10" className="opacity-30" />
      <path d="M12 2a10 10 0 0 1 10 10" style={{ strokeDasharray: 16, strokeDashoffset: 0 }} />
    </svg>
  )
}

// ─── Sitemap Fetch Button (used inside RobotsSection results) ─────────────────

function SitemapFetchButton({ sitemapUrl, onFetch }: { sitemapUrl: string; onFetch: (url: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onFetch(sitemapUrl)}
      className="flex-shrink-0 inline-flex items-center gap-1 bg-orange/10 text-orange font-display font-bold text-[11px] px-2.5 py-1 rounded-lg hover:bg-orange/20 transition-colors"
    >
      <SitemapIcon className="w-3 h-3" />
      Fetch Sitemap
    </button>
  )
}

// ─── Robots Validator Section ─────────────────────────────────────────────────

function RobotsSection({ onFetchSitemap }: { onFetchSitemap?: (url: string) => void }) {
  const [content, setContent] = useState('')
  const [result, setResult] = useState<RobotsParseResult | null>(null)
  const [testUrl, setTestUrl] = useState('')
  const [testResult, setTestResult] = useState<{ allowed: boolean; matchedRule: string; matchedAgent: string } | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlFetching, setUrlFetching] = useState(false)
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null)

  const handleValidate = () => {
    if (!content.trim()) return
    const parsed = parseRobotsTxt(content)
    setResult(parsed)
    setTestResult(null)
  }

  const handleTestUrl = () => {
    if (!result || !testUrl.trim()) return
    const res = testUrlAgainstRobots(result, testUrl.trim())
    setTestResult(res)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTestUrl()
  }

  async function fetchFromUrl(targetUrl: string, type: 'robots' | 'sitemap') {
    setUrlFetching(true)
    setUrlFetchError(null)
    try {
      let fetchUrl = targetUrl
      if (type === 'robots') {
        const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl)
        fetchUrl = `${parsed.protocol}//${parsed.host}/robots.txt`
      }
      const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(fetchUrl)}`)
      const data = await res.json()
      if (data.error) {
        setUrlFetchError(data.error)
      } else {
        if (type === 'robots') {
          setContent(data.content)
          const parsed = parseRobotsTxt(data.content)
          setResult(parsed)
          setTestResult(null)
        }
      }
    } catch {
      setUrlFetchError('Failed to fetch URL')
    } finally {
      setUrlFetching(false)
    }
  }

  return (
    <SectionCard title="Robots.txt Validator" icon={<RobotsIcon className="w-4 h-4" />}>
      {/* URL fetch bar */}
      <div className="mb-4">
        <label className="font-body text-[13px] font-semibold text-navy/70 block mb-2">Fetch from URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) fetchFromUrl(urlInput.trim(), 'robots') }}
            placeholder="https://example.com — fetches /robots.txt automatically"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-body text-navy focus:outline-none focus:ring-2 focus:ring-orange/30"
          />
          <button
            type="button"
            onClick={() => { if (urlInput.trim()) fetchFromUrl(urlInput.trim(), 'robots') }}
            disabled={!urlInput.trim() || urlFetching}
            className="inline-flex items-center gap-1.5 bg-orange text-navy font-display font-bold text-[13px] px-4 py-2 rounded-lg hover:bg-orange/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {urlFetching ? (
              <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
            ) : null}
            {urlFetching ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {urlFetchError && (
          <p className="mt-2 text-[12px] font-body text-red-600">{urlFetchError}</p>
        )}
      </div>

      <InputArea
        label="Paste your robots.txt content"
        value={content}
        onChange={setContent}
        placeholder={`User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://example.com/sitemap.xml`}
        rows={10}
      />

      <button
        onClick={handleValidate}
        disabled={!content.trim()}
        className="mt-4 w-full bg-navy text-white font-display font-bold text-[14px] py-3 rounded-xl hover:bg-navy-light transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Validate Robots.txt
      </button>

      {result && (
        <div className="mt-8 space-y-6">

          {/* Issues */}
          <SubSection title="Issues">
            <IssueList issues={result.issues} />
          </SubSection>

          {/* AI Bot Status */}
          <SubSection title="AI Bot Access Status">
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider">Bot / User-agent</th>
                    <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {KNOWN_AI_BOTS.map((bot) => {
                    const blocked = result.blockedBots.includes(bot)
                    return (
                      <tr key={bot} className="bg-white hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-[12px] text-navy">{bot}</td>
                        <td className="px-4 py-3">
                          {blocked ? (
                            <span className="inline-flex items-center gap-1.5 text-red-700 font-body font-semibold text-[12px]">
                              <XCircleIcon className="w-3.5 h-3.5" />
                              Blocked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-green-700 font-body font-semibold text-[12px]">
                              <CheckCircleIcon className="w-3.5 h-3.5" />
                              Allowed
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </SubSection>

          {/* URL Tester */}
          <SubSection title="URL Tester">
            <p className="text-[13px] font-body text-navy/55 mb-3">
              Enter a path to test against the parsed rules (e.g. <code className="font-mono text-orange bg-orange/10 px-1 rounded">/blog/post-1</code>).
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="/blog/post-1"
                  className="w-full pl-9 pr-4 py-2.5 font-mono text-[13px] bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange/40 focus:border-orange/50 placeholder:text-gray-400"
                />
              </div>
              <button
                onClick={handleTestUrl}
                disabled={!testUrl.trim()}
                className="bg-orange text-navy font-display font-bold text-[13px] px-5 py-2.5 rounded-lg hover:bg-orange/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Test URL
              </button>
            </div>

            {testResult && (
              <div className={`mt-3 flex items-start gap-3 rounded-lg px-4 py-3 border ${
                testResult.allowed
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                {testResult.allowed
                  ? <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  : <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
                <div>
                  <p className={`font-display font-bold text-[14px] ${testResult.allowed ? 'text-green-700' : 'text-red-700'}`}>
                    {testResult.allowed ? 'Allowed' : 'Blocked'}
                  </p>
                  <p className="font-body text-[12px] text-navy/60 mt-0.5">
                    Agent: <code className="font-mono">{testResult.matchedAgent}</code>
                    {' · '}
                    Rule: <code className="font-mono">{testResult.matchedRule}</code>
                  </p>
                </div>
              </div>
            )}
          </SubSection>

          {/* Sitemap URLs */}
          {result.sitemapUrls.length > 0 && (
            <SubSection title={`Sitemap URLs Found (${result.sitemapUrls.length})`}>
              <ul className="space-y-1.5">
                {result.sitemapUrls.map((url, i) => (
                  <li key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <span className="w-4 h-4 rounded bg-orange/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-orange text-[9px] font-bold">{i + 1}</span>
                    </span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-orange hover:underline truncate flex-1"
                    >
                      {url}
                    </a>
                    {onFetchSitemap && (
                      <SitemapFetchButton sitemapUrl={url} onFetch={onFetchSitemap} />
                    )}
                  </li>
                ))}
              </ul>
            </SubSection>
          )}

          {/* Crawl delay */}
          {result.crawlDelay !== undefined && (
            <SubSection title="Crawl Delay">
              <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                <span className="font-body text-[13px] text-amber-800">
                  Crawl-delay set to <strong>{result.crawlDelay}s</strong>
                </span>
              </div>
            </SubSection>
          )}

          {/* Parsed groups summary */}
          <SubSection title={`Parsed Groups (${result.groups.length})`}>
            <div className="space-y-2">
              {result.groups.map((group, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="font-mono text-[12px] font-semibold text-navy mb-2">
                    User-agent: {group.userAgent}
                  </p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-body text-navy/60">
                    <span><strong className="text-navy">{group.allows.length}</strong> Allow rule{group.allows.length !== 1 ? 's' : ''}</span>
                    <span><strong className="text-navy">{group.disallows.length}</strong> Disallow rule{group.disallows.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </SubSection>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Sitemap Validator Section ────────────────────────────────────────────────

function SitemapSection({
  externalContent,
  externalResult,
  onContentChange,
  onResultChange,
}: {
  externalContent?: string
  externalResult?: SitemapParseResult | null
  onContentChange?: (v: string) => void
  onResultChange?: (v: SitemapParseResult | null) => void
}) {
  const [internalContent, setInternalContent] = useState('')
  const [internalResult, setInternalResult] = useState<SitemapParseResult | null>(null)

  const content = externalContent !== undefined ? externalContent : internalContent
  const result = externalResult !== undefined ? externalResult : internalResult
  const setContent = (v: string) => {
    if (onContentChange) onContentChange(v)
    else setInternalContent(v)
  }
  const setResult = (v: SitemapParseResult | null) => {
    if (onResultChange) onResultChange(v)
    else setInternalResult(v)
  }

  const [urlInput, setUrlInput] = useState('')
  const [urlFetching, setUrlFetching] = useState(false)
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null)

  const handleValidate = () => {
    if (!content.trim()) return
    setResult(parseSitemapXml(content))
  }

  async function fetchFromUrl(targetUrl: string) {
    setUrlFetching(true)
    setUrlFetchError(null)
    try {
      const fetchUrl = targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl
      const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(fetchUrl)}`)
      const data = await res.json()
      if (data.error) {
        setUrlFetchError(data.error)
      } else {
        setContent(data.content)
        setResult(parseSitemapXml(data.content))
      }
    } catch {
      setUrlFetchError('Failed to fetch URL')
    } finally {
      setUrlFetching(false)
    }
  }

  return (
    <SectionCard title="Sitemap.xml Validator" icon={<SitemapIcon className="w-4 h-4" />}>
      {/* URL fetch bar */}
      <div className="mb-4">
        <label className="font-body text-[13px] font-semibold text-navy/70 block mb-2">Fetch from URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && urlInput.trim()) fetchFromUrl(urlInput.trim()) }}
            placeholder="https://example.com/sitemap.xml"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-body text-navy focus:outline-none focus:ring-2 focus:ring-orange/30"
          />
          <button
            type="button"
            onClick={() => { if (urlInput.trim()) fetchFromUrl(urlInput.trim()) }}
            disabled={!urlInput.trim() || urlFetching}
            className="inline-flex items-center gap-1.5 bg-orange text-navy font-display font-bold text-[13px] px-4 py-2 rounded-lg hover:bg-orange/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {urlFetching ? (
              <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
            ) : null}
            {urlFetching ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {urlFetchError && (
          <p className="mt-2 text-[12px] font-body text-red-600">{urlFetchError}</p>
        )}
      </div>

      <InputArea
        label="Paste your sitemap.xml content"
        value={content}
        onChange={setContent}
        placeholder={`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://example.com/</loc>\n    <lastmod>2024-01-01</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>`}
        rows={10}
      />

      <button
        onClick={handleValidate}
        disabled={!content.trim()}
        className="mt-4 w-full bg-navy text-white font-display font-bold text-[14px] py-3 rounded-xl hover:bg-navy-light transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Validate Sitemap
      </button>

      {result && (
        <div className="mt-8 space-y-6">

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
              <div className={`font-display font-extrabold text-[22px] mb-0.5 ${result.valid ? 'text-green-600' : 'text-red-600'}`}>
                {result.valid ? 'Valid' : 'Invalid'}
              </div>
              <div className="font-body text-[11px] text-navy/50 uppercase tracking-wider">Status</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
              <div className="font-display font-extrabold text-[22px] text-navy mb-0.5">
                {result.urlCount.toLocaleString()}
              </div>
              <div className="font-body text-[11px] text-navy/50 uppercase tracking-wider">URLs</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
              <div className="font-display font-extrabold text-[22px] text-navy mb-0.5">
                {result.isSitemapIndex ? 'Index' : 'Regular'}
              </div>
              <div className="font-body text-[11px] text-navy/50 uppercase tracking-wider">Type</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center">
              <div className="font-display font-extrabold text-[22px] text-orange mb-0.5">
                {result.issues.length}
              </div>
              <div className="font-body text-[11px] text-navy/50 uppercase tracking-wider">Issues</div>
            </div>
          </div>

          {/* Metadata presence */}
          <SubSection title="Metadata Fields">
            <div className="flex flex-wrap gap-2">
              <MetaBadge label="lastmod" active={result.hasLastmod} />
              <MetaBadge label="changefreq" active={result.hasChangefreq} />
              <MetaBadge label="priority" active={result.hasPriority} />
            </div>
          </SubSection>

          {/* Issues */}
          <SubSection title="Issues">
            <IssueList issues={result.issues} />
          </SubSection>

          {/* Sample URLs */}
          {result.sampleUrls.length > 0 && (
            <SubSection title={`Sample URLs (first ${result.sampleUrls.length})`}>
              <ul className="space-y-1.5">
                {result.sampleUrls.map((url, i) => (
                  <li key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <span className="w-5 h-5 rounded bg-navy/10 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-navy/50 font-mono">
                      {i + 1}
                    </span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-orange hover:underline truncate"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </SubSection>
          )}
        </div>
      )}
    </SectionCard>
  )
}

// ─── Bot Reference Card ───────────────────────────────────────────────────────

function BotReferenceSection() {
  return (
    <SectionCard title="Bot User-Agent Reference" icon={<BotIcon className="w-4 h-4" />}>
      <p className="font-body text-[13px] text-navy/55 mb-4">
        Use these exact user-agent strings in your robots.txt to target specific crawlers. Note that bots are not required to obey robots.txt — it is advisory only.
      </p>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider">User-agent string</th>
              <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider hidden sm:table-cell">Owner</th>
              <th className="text-left px-4 py-2.5 font-body font-semibold text-navy/60 text-[11px] uppercase tracking-wider hidden md:table-cell">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {BOT_REFERENCE.map((bot) => (
              <tr key={bot.agent} className="bg-white hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 font-body text-[13px] text-navy font-semibold">{bot.name}</td>
                <td className="px-4 py-3">
                  <code className="font-mono text-[12px] text-orange bg-orange/10 px-2 py-0.5 rounded">{bot.agent}</code>
                </td>
                <td className="px-4 py-3 font-body text-[12px] text-navy/60 hidden sm:table-cell">{bot.owner}</td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className={`inline-block text-[11px] font-body font-semibold px-2 py-0.5 rounded-full ${
                    bot.type.includes('AI') || bot.type.includes('Search')
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {bot.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <p className="font-body text-[12px] text-amber-800 leading-relaxed">
          <strong>Note:</strong> Robots.txt is a courtesy protocol. Bad actors and some AI scrapers may ignore it entirely. For stronger protection, use server-level blocking or authentication.
        </p>
      </div>
    </SectionCard>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RobotsValidatorPage() {
  const [sitemapContent, setSitemapContent] = useState('')
  const [sitemapResult, setSitemapResult] = useState<SitemapParseResult | null>(null)

  function handleFetchSitemapFromRobots(sitemapUrl: string) {
    // Scroll to the sitemap section, populate the URL fetch, then trigger fetch
    const el = document.getElementById('sitemap-section')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    fetch(`/api/fetch-url?url=${encodeURIComponent(sitemapUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setSitemapContent(data.content)
          setSitemapResult(parseSitemapXml(data.content))
        }
      })
      .catch(() => {/* silently ignore — SitemapSection handles its own errors */})
  }

  return (
    <div className="bg-navy min-h-screen">
      {/* Page header */}
      <div className="bg-navy border-b border-navy-border/50">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-orange/15 flex items-center justify-center">
              <RobotsIcon className="w-5 h-5 text-orange" />
            </div>
            <div>
              <p className="text-[11px] font-body font-semibold text-orange/70 uppercase tracking-[0.2em]">SEO Tools</p>
              <h1 className="font-display font-extrabold text-[26px] text-white leading-tight">Robots Validator</h1>
            </div>
          </div>
          <p className="font-body text-[14px] text-white/50 max-w-xl">
            Validate robots.txt syntax, check AI bot access status, test URLs against rules, and validate sitemap structure — all client-side, nothing uploaded.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <RobotsSection onFetchSitemap={handleFetchSitemapFromRobots} />
        <div id="sitemap-section">
          <SitemapSection
            externalContent={sitemapContent}
            externalResult={sitemapResult}
            onContentChange={setSitemapContent}
            onResultChange={setSitemapResult}
          />
        </div>
        <BotReferenceSection />
      </div>
    </div>
  )
}
