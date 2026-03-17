'use client'

import { useState } from 'react'

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:      '#0d0f14',
  surface: '#141720',
  border:  '#1e2330',
  accent:  '#00e5a0',
  accent2: '#4d7cff',
  warn:    '#ffb340',
  danger:  '#ff5f57',
  text:    '#c8cdd8',
  muted:   '#5a6070',
  heading: '#f0f2f5',
  codeBg:  '#0a0c10',
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Callout({ type, icon, children }: { type: 'warn' | 'info' | 'success' | 'danger'; icon: string; children: React.ReactNode }) {
  const styles: Record<string, { bg: string; border: string; color: string }> = {
    warn:    { bg: 'rgba(255,179,64,0.08)',  border: 'rgba(255,179,64,0.25)',  color: T.warn },
    info:    { bg: 'rgba(77,124,255,0.08)',  border: 'rgba(77,124,255,0.25)',  color: T.accent2 },
    success: { bg: 'rgba(0,229,160,0.07)',   border: 'rgba(0,229,160,0.2)',    color: T.accent },
    danger:  { bg: 'rgba(255,95,87,0.08)',   border: 'rgba(255,95,87,0.25)',   color: T.danger },
  }
  const s = styles[type]
  return (
    <div style={{ borderRadius: 6, padding: '12px 16px', fontSize: 12, display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ lineHeight: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>{children}</span>
    </div>
  )
}

function StepNum({ n, variant = 'green' }: { n: string | number; variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger' }) {
  const bg: Record<string, string> = {
    green:  T.accent,
    blue:   T.accent2,
    warn:   T.warn,
    purple: '#9d6fff',
    danger: T.danger,
  }
  const color: Record<string, string> = {
    green: '#000', blue: '#fff', warn: '#000', purple: '#fff', danger: '#fff',
  }
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%', background: bg[variant], color: color[variant],
      fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>{n}</div>
  )
}

function SectionHeader({ step, variant, title, phase }: { step: string | number; variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger'; title: string; phase?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <StepNum n={step} variant={variant} />
      <h2 style={{ fontSize: 16, fontWeight: 700, color: T.heading, margin: 0 }}>{title}</h2>
      {phase && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: T.muted, marginLeft: 'auto', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{phase}</span>}
    </div>
  )
}

function PhaseBanner({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: T.muted, padding: '6px 0 16px 0', borderTop: `1px solid ${T.border}`, marginBottom: 24 }}>
      {text}
    </div>
  )
}

function Divider() {
  return (
    <div style={{ position: 'relative', height: 1, background: T.border, margin: '40px 0' }}>
      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: T.bg, color: T.border, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: '0 12px' }}>//</span>
    </div>
  )
}

function CodeBlock({ label, children }: { label: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    const el = document.getElementById(`code-${label.replace(/\s+/g, '-')}`)
    const text = el?.innerText ?? ''
    navigator.clipboard.writeText(text.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div style={{ background: T.codeBg, border: `1px solid ${T.border}`, borderRadius: 6, marginTop: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${T.border}`, background: '#0f1118' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: T.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        <button
          onClick={handleCopy}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: copied ? T.accent : T.muted, background: 'none', border: `1px solid ${copied ? T.accent : T.border}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.05em' }}
        >{copied ? 'copied!' : 'copy'}</button>
      </div>
      <pre
        id={`code-${label.replace(/\s+/g, '-')}`}
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.7, padding: 16, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}
      >{children}</pre>
    </div>
  )
}

function PromptBox({ id, label, children }: { id: string; label: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(children.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div style={{ background: T.codeBg, border: '1px solid #9d6fff44', borderRadius: 6, overflow: 'hidden', marginTop: 10 }} id={id}>
      <div style={{ background: '#1a1228', borderBottom: '1px solid #9d6fff33', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9d6fff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        <button
          onClick={handleCopy}
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: copied ? '#9d6fff' : T.muted, background: 'none', border: `1px solid ${copied ? '#9d6fff' : '#9d6fff44'}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', transition: 'all 0.15s' }}
        >{copied ? 'copied!' : 'copy'}</button>
      </div>
      <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.8, padding: 16, color: T.text, whiteSpace: 'pre-wrap', margin: 0 }}>{children}</pre>
    </div>
  )
}

function VarTable() {
  const rows = [
    { name: 'SITE_NAME', example: 'discoverycommunitycollege', note: 'RunCloud app name' },
    { name: 'DB_PREFIX',  example: 'wp_',                      note: 'Run: wp db prefix' },
    { name: 'SERVER_IP',  example: '123.456.78.90',             note: 'RunCloud dashboard → Server Info' },
    { name: 'SSH_USER',   example: 'discovery',                 note: 'RunCloud → SSH credentials' },
  ]
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, marginTop: 4 }}>
      <thead>
        <tr>
          {['Variable','Example','How to find it'].map(h => (
            <th key={h} style={{ textAlign: 'left', color: T.muted, fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10, padding: '6px 10px', borderBottom: `1px solid ${T.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name}>
            <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, color: T.accent2 }}>{r.name}</td>
            <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, color: T.accent }}>{r.example}</td>
            <td style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, color: T.muted, fontSize: 11 }}>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const card = (children: React.ReactNode) => (
  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 20 }}>
    {children}
  </div>
)

const p = (text: React.ReactNode) => <p style={{ marginBottom: 12, fontSize: 13 }}>{text}</p>
const sub = (text: string) => <p style={{ color: T.heading, fontSize: 12, marginBottom: 4, marginTop: 14 }}>{text}</p>

// ── Prompt templates ─────────────────────────────────────────────────────────
const PROMPT_A = `You are a WordPress redirect specialist. Generate a SQL INSERT file for Rank Math's wp_rank_math_redirections table.

Site: [SITE_DOMAIN e.g. example.com]
DB prefix: [DB_PREFIX e.g. wp_]

Redirects (old → new):
[PASTE YOUR FROM/TO URL LIST HERE — one per line]

Rules:
- All redirects should be 301
- The \`sources\` column must be correctly PHP-serialized with accurate byte-length counts
- The \`url_to\` column should use relative paths (e.g. /new-page/)
- Include hits=0, status='active', created=NOW(), updated=NOW()
- Add a comment above each row showing the redirect mapping
- End the file with a comment reminding me to run: wp transient delete --all`

const PROMPT_B = `You are a WordPress redirect specialist. Generate a SQL INSERT file for Rank Math's wp_rank_math_redirections table.

Site: [SITE_DOMAIN e.g. example.com]
DB prefix: [DB_PREFIX e.g. wp_]

Below is a CSV export from the Redirection plugin. Use the source and destination URL columns to build the redirect list:
[PASTE CSV CONTENTS HERE]

Rules:
- All redirects should be 301
- The \`sources\` column must be correctly PHP-serialized with accurate byte-length counts
- The \`url_to\` column should use relative paths (e.g. /new-page/)
- Include hits=0, status='active', created=NOW(), updated=NOW()
- Add a comment above each row showing the redirect mapping
- End the file with a comment reminding me to run: wp transient delete --all`

// ── Page ─────────────────────────────────────────────────────────────────────
export default function RankMathRedirectsPage() {
  const [workflow, setWorkflow] = useState<'a' | 'b'>('a')

  const switchWorkflow = (wf: 'a' | 'b') => {
    setWorkflow(wf)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: "'Syne', sans-serif", fontSize: 14, lineHeight: 1.6, padding: '48px 24px', maxWidth: 960, margin: '0 auto' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
      `}</style>

      {/* Header */}
      <header style={{ borderLeft: `3px solid ${T.accent}`, paddingLeft: 20, marginBottom: 36 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.accent, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6 }}>
          // enrollment resources — internal tooling
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: T.heading, lineHeight: 1.1, marginBottom: 8 }}>
          Rank Math Bulk Redirects<br />via WP-CLI + SQL
        </h1>
        <p style={{ color: T.muted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          rankmath free &nbsp;·&nbsp; runcloud servers &nbsp;·&nbsp; wp_rank_math_redirections
        </p>
      </header>

      {/* Workflow Toggle */}
      <div style={{ display: 'flex', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, marginBottom: 40, width: 'fit-content', gap: 0 }}>
        <button
          onClick={() => switchWorkflow('a')}
          style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '10px 22px', border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'all 0.2s',
            background: workflow === 'a' ? T.accent : 'transparent',
            color: workflow === 'a' ? '#000' : T.muted,
            fontWeight: workflow === 'a' ? 700 : 400,
          }}
        >Workflow A — Fresh Redirects</button>
        <button
          onClick={() => switchWorkflow('b')}
          style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '10px 22px', border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'all 0.2s',
            background: workflow === 'b' ? T.accent2 : 'transparent',
            color: workflow === 'b' ? '#fff' : T.muted,
            fontWeight: workflow === 'b' ? 700 : 400,
          }}
        >Workflow B — Migrate from Safe Redirect Manager</button>
      </div>

      {/* ── WORKFLOW A ── */}
      {workflow === 'a' && (
        <div>
          <PhaseBanner text="— phase 01   pre-flight checks" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="!" variant="warn" title="Gather Site Variables First" phase="Before anything" />
            {card(<>
              {p("Confirm these values before running any commands. Swap them in wherever you see placeholders below.")}
              <VarTable />
              <Callout type="warn" icon="⚠">Most sites use <strong>wp_</strong> but custom prefixes break the table name. Always confirm with <strong>wp db prefix</strong> before running SQL.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 02   generate the sql file" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="AI" variant="purple" title="Generate SQL with Claude" phase="Prep" />
            {card(<>
              {p(<>Use the prompt template below each time. Claude will generate a correctly serialized <code style={{ color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>.sql</code> file — the serialized <code style={{ color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>sources</code> field is critical and must be generated, not written by hand.</>)}
              <PromptBox id="prompt-a" label="// claude prompt template">{PROMPT_A}</PromptBox>
              <Callout type="info" icon="ℹ">Never hand-write the serialized <strong>sources</strong> value. The byte-length numbers (s:29:) must exactly match the string — even one character off breaks the redirect silently.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 03   transfer file to server" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={1} title="Upload the .sql File" phase="Transfer" />
            {card(<>
              {p("Choose one method:")}
              {sub("Option A — SCP (recommended, from your local machine)")}
              <CodeBlock label="terminal — local machine">{'scp /path/to/redirects.sql [SSH_USER]@[SERVER_IP]:/home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
              {sub("Option B — Paste directly on server via SSH")}
              <CodeBlock label="step 1 — ssh in and navigate">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
              <CodeBlock label="step 2 — create and open the file">{'nano redirects.sql'}</CodeBlock>
              <Callout type="info" icon="ℹ">Paste your SQL content into nano, then save: <strong>Ctrl+X</strong> → <strong>Y</strong> → <strong>Enter</strong></Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 04   execute" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={2} title="SSH In & Navigate to Site Root" phase="Execute" />
            {card(<>
              <CodeBlock label="terminal">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
              <Callout type="info" icon="ℹ">Skip this step if you used Option B above — you&apos;re already in the right directory.</Callout>
            </>)}
          </div>

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={3} title="Run the SQL Import" phase="Execute" />
            {card(<CodeBlock label="wp-cli">{'wp db query < redirects.sql'}</CodeBlock>)}
          </div>

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={4} title="Clear the Redirect Cache" phase="Execute" />
            {card(<>
              <CodeBlock label="wp-cli">{'wp transient delete --all'}</CodeBlock>
              <Callout type="warn" icon="⚠">Don&apos;t skip this. Without clearing the cache, redirects may not fire immediately even if the DB rows are correct.</Callout>
              {sub("Then flush the site cache from WP Admin:")}
              <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 05   verify" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={5} variant="blue" title="Verify the Rows Were Inserted" phase="Verify" />
            {card(<>
              <CodeBlock label="wp-cli — check all redirects">{'wp db query "SELECT id, url_to, header_code, status FROM [DB_PREFIX]rank_math_redirections;"'}</CodeBlock>
              <CodeBlock label="wp-cli — check for any remaining 302s">{'wp db query "SELECT id, url_to, header_code FROM [DB_PREFIX]rank_math_redirections WHERE header_code != 301;"'}</CodeBlock>
              <CodeBlock label="terminal — spot-check a live redirect">{'curl -I https://[SITE_DOMAIN]/[old-url-path]/\n# Look for: HTTP/2 301 and Location: https://[SITE_DOMAIN]/[new-url-path]/'}</CodeBlock>
              <Callout type="success" icon="✓">Also confirm in WP Admin → Rank Math → Redirections. All rows should appear as active 301s.</Callout>
            </>)}
          </div>

          <Divider />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="↻" variant="warn" title="Fix Accidental 302s (if needed)" phase="Cleanup" />
            {card(<>
              {p("If the DB query above shows any 302s that should be 301s, bulk-update them in one command:")}
              <CodeBlock label="wp-cli — bulk fix 302 → 301">{'wp db query "UPDATE [DB_PREFIX]rank_math_redirections SET header_code = 301 WHERE header_code = 302;"'}</CodeBlock>
              <CodeBlock label="wp-cli — clear cache after update">{'wp transient delete --all'}</CodeBlock>
              {sub("Then flush the site cache from WP Admin:")}
              <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
            </>)}
          </div>
        </div>
      )}

      {/* ── WORKFLOW B ── */}
      {workflow === 'b' && (
        <div>
          <Callout type="info" icon="ℹ">
            Use this workflow when a site already has redirects stored in <strong>Safe Redirect Manager</strong> that need to be migrated into Rank Math. The Redirection plugin acts as a temporary bridge — it imports from Safe Redirect Manager, exports to CSV, and then both plugins are removed once the SQL is in Rank Math.
          </Callout>
          <div style={{ marginTop: 32 }} />

          <PhaseBanner text="— phase 01   pre-flight checks" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="!" variant="warn" title="Gather Site Variables First" phase="Before anything" />
            {card(<>
              {p("Same as Workflow A — confirm these before running any commands.")}
              <VarTable />
              <Callout type="warn" icon="⚠">Most sites use <strong>wp_</strong> but custom prefixes break the table name. Always confirm with <strong>wp db prefix</strong> before running SQL.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 02   install redirection plugin" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={1} title="SSH In & Install Redirection via WP-CLI" phase="SSH" />
            {card(<>
              <CodeBlock label="step 1 — ssh in and navigate">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
              <CodeBlock label="step 2 — install and activate the plugin">{'wp plugin install redirection --activate'}</CodeBlock>
              <Callout type="danger" icon="⚠">This plugin is <strong>temporary</strong> — it will be removed at the end of this workflow. Do not leave it active on client sites.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 03   import from safe redirect manager" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={2} title="Import Redirects from Safe Redirect Manager" phase="SSH" />
            {card(<>
              <CodeBlock label="wp-cli — run the import">{'wp redirection import plugin safe-redirect-manager'}</CodeBlock>
              <Callout type="warn" icon="⚠">If this command returns an error or isn&apos;t recognised, fall back to WP Admin → <strong>Tools → Redirection → Import/Export → Import from plugin → Safe Redirect Manager</strong>. CLI import availability depends on the installed version of Redirection.</Callout>
              <Callout type="success" icon="✓">After importing, spot-check the redirect count makes sense before proceeding to export.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 04   export from redirection" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={3} title="Export Redirects to CSV" phase="SSH" />
            {card(<>
              <CodeBlock label="wp-cli — export all redirects to csv">{'wp redirection list --format=csv > redirects_export.csv'}</CodeBlock>
              <CodeBlock label="terminal — copy the csv down to your local machine">{'scp [SSH_USER]@[SERVER_IP]:/home/runcloud/webapps/[SITE_NAME]/redirects_export.csv ~/Desktop/'}</CodeBlock>
              <Callout type="info" icon="ℹ">Open the CSV locally and confirm the <strong>source</strong> and <strong>url</strong> columns look correct before pasting into the Claude prompt.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 05   generate the sql file" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="AI" variant="purple" title="Generate SQL with Claude" phase="Prep" />
            {card(<>
              {p("Use the prompt template below. Paste the contents of your exported CSV directly into the prompt.")}
              <PromptBox id="prompt-b" label="// claude prompt template">{PROMPT_B}</PromptBox>
              <Callout type="info" icon="ℹ">Never hand-write the serialized <strong>sources</strong> value. The byte-length numbers (s:29:) must exactly match the string — even one character off breaks the redirect silently.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 06   transfer sql file to server" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={4} title="Upload the .sql File" phase="Transfer" />
            {card(<>
              {p("Choose one method:")}
              {sub("Option A — SCP from your local machine")}
              <CodeBlock label="terminal — local machine">{'scp /path/to/redirects.sql [SSH_USER]@[SERVER_IP]:/home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
              {sub("Option B — Paste directly on the server (already SSH'd in)")}
              <CodeBlock label="create and open the file">{'nano redirects.sql'}</CodeBlock>
              <Callout type="info" icon="ℹ">Paste your SQL content into nano, then save: <strong>Ctrl+X</strong> → <strong>Y</strong> → <strong>Enter</strong></Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 07   execute" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={5} title="Run the SQL Import" phase="Execute" />
            {card(<>
              <Callout type="info" icon="ℹ">You should still be SSH&apos;d in from Phase 02. If your session timed out: <code>ssh [SSH_USER]@[SERVER_IP]</code> then <code>cd /home/runcloud/webapps/[SITE_NAME]/</code></Callout>
              <CodeBlock label="wp-cli">{'wp db query < redirects.sql'}</CodeBlock>
            </>)}
          </div>

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={6} title="Clear the Redirect Cache" phase="Execute" />
            {card(<>
              <CodeBlock label="wp-cli">{'wp transient delete --all'}</CodeBlock>
              <Callout type="warn" icon="⚠">Don&apos;t skip this. Without clearing the cache, redirects may not fire immediately even if the DB rows are correct.</Callout>
              {sub("Then flush the site cache from WP Admin:")}
              <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 08   verify" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={8} variant="blue" title="Verify the Rows Were Inserted" phase="Verify" />
            {card(<>
              <CodeBlock label="wp-cli — check all redirects">{'wp db query "SELECT id, url_to, header_code, status FROM [DB_PREFIX]rank_math_redirections;"'}</CodeBlock>
              <CodeBlock label="wp-cli — check for any remaining 302s">{'wp db query "SELECT id, url_to, header_code FROM [DB_PREFIX]rank_math_redirections WHERE header_code != 301;"'}</CodeBlock>
              <CodeBlock label="terminal — spot-check a live redirect">{'curl -I https://[SITE_DOMAIN]/[old-url-path]/\n# Look for: HTTP/2 301 and Location: https://[SITE_DOMAIN]/[new-url-path]/'}</CodeBlock>
              <Callout type="success" icon="✓">Also confirm in WP Admin → Rank Math → Redirections. All rows should appear as active 301s.</Callout>
            </>)}
          </div>

          <PhaseBanner text="— phase 09   cleanup — remove temporary plugins" />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={9} variant="danger" title="Remove Redirection Plugin" phase="SSH" />
            {card(<>
              <CodeBlock label="wp-cli — deactivate and delete">{'wp plugin deactivate redirection && wp plugin delete redirection'}</CodeBlock>
              <Callout type="danger" icon="⚠">Do not leave Redirection active. It runs its own redirect logic and will conflict with Rank Math, causing duplicate or unexpected redirect behaviour.</Callout>
            </>)}
          </div>

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step={10} variant="danger" title="Remove Safe Redirect Manager" phase="SSH" />
            {card(<>
              <CodeBlock label="wp-cli — deactivate and delete">{'wp plugin deactivate safe-redirect-manager && wp plugin delete safe-redirect-manager'}</CodeBlock>
              <Callout type="danger" icon="⚠">All redirects are now managed by Rank Math. Leaving Safe Redirect Manager active means two plugins are handling the same redirects — remove it entirely.</Callout>
            </>)}
          </div>

          <Divider />

          <div style={{ marginBottom: 36 }}>
            <SectionHeader step="↻" variant="warn" title="Fix Accidental 302s (if needed)" phase="Cleanup" />
            {card(<>
              {p("If the DB query above shows any 302s that should be 301s, bulk-update them in one command:")}
              <CodeBlock label="wp-cli — bulk fix 302 → 301">{'wp db query "UPDATE [DB_PREFIX]rank_math_redirections SET header_code = 301 WHERE header_code = 302;"'}</CodeBlock>
              <CodeBlock label="wp-cli — clear cache after update">{'wp transient delete --all'}</CodeBlock>
              {sub("Then flush the site cache from WP Admin:")}
              <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
            </>)}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ marginTop: 56, paddingTop: 20, borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: T.muted }}>
        <span>enrollment resources — internal tooling</span>
        <span>rankmath free &nbsp;·&nbsp; runcloud &nbsp;·&nbsp; wp-cli</span>
      </footer>
    </div>
  )
}
