'use client'

import { useState } from 'react'

// ── Sub-components ───────────────────────────────────────────────────────────

function Callout({ type, icon, children }: { type: 'warn' | 'info' | 'success' | 'danger'; icon: string; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    warn:    'border-l-4 border-amber-500 bg-amber-500/10 text-amber-200',
    info:    'border-l-4 border-blue-500 bg-blue-500/10 text-blue-200',
    success: 'border-l-4 border-orange bg-orange/10 text-orange/90',
    danger:  'border-l-4 border-red-500 bg-red-500/10 text-red-200',
  }
  return (
    <div className={`flex gap-3 items-start rounded-r-lg px-4 py-3 mt-3 text-[12px] leading-relaxed font-mono ${styles[type]}`}>
      <span className="text-[14px] flex-shrink-0 mt-0.5">{icon}</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}

function StepNum({ n, variant = 'green' }: { n: string | number; variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger' }) {
  const bg: Record<string, string> = {
    green:  'bg-orange text-navy-deep',
    blue:   'bg-blue-500 text-white',
    warn:   'bg-amber-400 text-navy-deep',
    purple: 'bg-purple-500 text-white',
    danger: 'bg-red-500 text-white',
  }
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold ${bg[variant]}`}>
      {n}
    </div>
  )
}

function SectionHeader({ step, variant, title, phase }: { step: string | number; variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger'; title: string; phase?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <StepNum n={step} variant={variant} />
      <h2 className="text-[16px] font-display font-bold text-white m-0">{title}</h2>
      {phase && (
        <span className="font-mono text-[10px] text-white/40 ml-auto tracking-widest uppercase">
          {phase}
        </span>
      )}
    </div>
  )
}

function PhaseBanner({ text }: { text: string }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-white/40 pt-1.5 pb-4 border-t border-navy-border mb-6">
      {text}
    </div>
  )
}

function Divider() {
  return (
    <div className="relative h-px bg-navy-border my-10">
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-navy text-navy-border font-mono text-[11px] px-3">
        //
      </span>
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
    <div className="rounded-lg bg-[#0a0c10] border border-navy-border mt-3 overflow-hidden">
      <div className="flex justify-between items-center px-4 py-2 border-b border-navy-border bg-[#0f1118]">
        <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">{label}</span>
        <button
          onClick={handleCopy}
          className={`font-mono text-[10px] bg-transparent border rounded px-2.5 py-0.5 cursor-pointer transition-all duration-150 tracking-wide ${
            copied
              ? 'text-orange border-orange'
              : 'text-white/40 border-navy-border hover:text-white/60'
          }`}
        >
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre
        id={`code-${label.replace(/\s+/g, '-')}`}
        className="font-mono text-[12px] leading-relaxed p-4 text-white/70 whitespace-pre-wrap break-all m-0"
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
    <div className="border border-purple-500/30 bg-purple-500/10 rounded-lg overflow-hidden mt-3" id={id}>
      <div className="bg-purple-900/30 border-b border-purple-500/20 px-4 py-2 flex justify-between items-center">
        <span className="font-mono text-[10px] text-purple-400 tracking-widest uppercase">{label}</span>
        <button
          onClick={handleCopy}
          className={`font-mono text-[10px] bg-transparent border rounded px-2.5 py-0.5 cursor-pointer transition-all duration-150 ${
            copied
              ? 'text-purple-400 border-purple-400'
              : 'text-white/40 border-purple-500/30 hover:text-purple-400'
          }`}
        >
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre className="font-mono text-[12px] leading-[1.8] p-4 text-white/70 whitespace-pre-wrap m-0">{children}</pre>
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
    <table className="w-full border-collapse font-mono text-[12px] mt-1">
      <thead>
        <tr>
          {['Variable', 'Example', 'How to find it'].map(h => (
            <th key={h} className="text-left text-white/40 font-normal tracking-widest uppercase text-[10px] px-2.5 py-1.5 border-b border-navy-border">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name}>
            <td className="px-2.5 py-2 border-b border-navy-border text-blue-400">{r.name}</td>
            <td className="px-2.5 py-2 border-b border-navy-border text-orange">{r.example}</td>
            <td className="px-2.5 py-2 border-b border-navy-border text-white/40 text-[11px]">{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-navy-card border border-navy-border rounded-xl p-5">
      {children}
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[13px] text-white/70 font-body">{children}</p>
}

function Sub({ children }: { children: string }) {
  return <p className="text-white text-[12px] mb-1 mt-3.5 font-body font-semibold">{children}</p>
}

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


// ── Page ─────────────────────────────────────────────────────────────────────
export default function RankMathRedirectsPage() {
  const [workflow, setWorkflow] = useState<'a' | 'b'>('a')

  const switchWorkflow = (wf: 'a' | 'b') => {
    setWorkflow(wf)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-navy text-white/70 font-body text-[14px] leading-relaxed py-12 px-6">
      <div className="max-w-[960px] mx-auto">

        {/* Header */}
        <header className="border-l-[3px] border-orange pl-5 mb-9">
          <div className="font-mono text-[11px] text-orange tracking-[0.15em] uppercase mb-1.5">
            // enrollment resources — internal tooling
          </div>
          <h1 className="font-display text-[32px] font-extrabold text-white leading-tight mb-2">
            Rank Math Bulk Redirects<br />via WP-CLI + SQL
          </h1>
          <p className="text-white/40 font-mono text-[12px]">
            rankmath free &nbsp;·&nbsp; runcloud servers &nbsp;·&nbsp; wp_rank_math_redirections
          </p>
        </header>

        {/* Workflow Toggle */}
        <div className="flex bg-navy-card border border-navy-border rounded-lg p-1 mb-10 w-fit gap-0">
          <button
            onClick={() => switchWorkflow('a')}
            className={`font-mono text-[11px] tracking-[0.08em] uppercase px-5 py-2.5 border-none rounded-md cursor-pointer transition-all duration-200 ${
              workflow === 'a'
                ? 'bg-orange text-navy-deep font-bold'
                : 'bg-transparent text-white/40 font-normal hover:text-white/60'
            }`}
          >
            Workflow A — Fresh Redirects
          </button>
          <button
            onClick={() => switchWorkflow('b')}
            className={`font-mono text-[11px] tracking-[0.08em] uppercase px-5 py-2.5 border-none rounded-md cursor-pointer transition-all duration-200 ${
              workflow === 'b'
                ? 'bg-blue-500 text-white font-bold'
                : 'bg-transparent text-white/40 font-normal hover:text-white/60'
            }`}
          >
            Workflow B — Migrate from Safe Redirect Manager
          </button>
        </div>

        {/* ── WORKFLOW A ── */}
        {workflow === 'a' && (
          <div>
            <PhaseBanner text="— phase 01   pre-flight checks" />

            <div className="mb-9">
              <SectionHeader step="!" variant="warn" title="Gather Site Variables First" phase="Before anything" />
              <Card>
                <P>Confirm these values before running any commands. Swap them in wherever you see placeholders below.</P>
                <VarTable />
                <Callout type="warn" icon="⚠">Most sites use <strong>wp_</strong> but custom prefixes break the table name. Always confirm with <strong>wp db prefix</strong> before running SQL.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 02   generate the sql file" />

            <div className="mb-9">
              <SectionHeader step="AI" variant="purple" title="Generate SQL with Claude" phase="Prep" />
              <Card>
                <P>Use the prompt template below each time. Claude will generate a correctly serialized <code className="text-orange font-mono">.sql</code> file — the serialized <code className="text-orange font-mono">sources</code> field is critical and must be generated, not written by hand.</P>
                <PromptBox id="prompt-a" label="// claude prompt template">{PROMPT_A}</PromptBox>
                <Callout type="info" icon="ℹ">Never hand-write the serialized <strong>sources</strong> value. The byte-length numbers (s:29:) must exactly match the string — even one character off breaks the redirect silently.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 03   transfer file to server" />

            <div className="mb-9">
              <SectionHeader step={1} title="Upload the .sql File" phase="Transfer" />
              <Card>
                <P>Choose one method:</P>
                <Sub>Option A — SCP (recommended, from your local machine)</Sub>
                <CodeBlock label="terminal — local machine">{'scp /path/to/redirects.sql [SSH_USER]@[SERVER_IP]:/home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
                <Sub>Option B — Paste directly on server via SSH</Sub>
                <CodeBlock label="step 1 — ssh in and navigate">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
                <CodeBlock label="step 2 — create and open the file">{'nano redirects.sql'}</CodeBlock>
                <Callout type="info" icon="ℹ">Paste your SQL content into nano, then save: <strong>Ctrl+X</strong> → <strong>Y</strong> → <strong>Enter</strong></Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 04   execute" />

            <div className="mb-9">
              <SectionHeader step={2} title="SSH In & Navigate to Site Root" phase="Execute" />
              <Card>
                <CodeBlock label="terminal">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
                <Callout type="info" icon="ℹ">Skip this step if you used Option B above — you&apos;re already in the right directory.</Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step={3} title="Run the SQL Import" phase="Execute" />
              <Card>
                <CodeBlock label="wp-cli">{'wp db query < redirects.sql'}</CodeBlock>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step={4} title="Clear the Redirect Cache" phase="Execute" />
              <Card>
                <CodeBlock label="wp-cli">{'wp transient delete --all'}</CodeBlock>
                <Callout type="warn" icon="⚠">Don&apos;t skip this. Without clearing the cache, redirects may not fire immediately even if the DB rows are correct.</Callout>
                <Sub>Then flush the site cache from WP Admin:</Sub>
                <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 05   verify" />

            <div className="mb-9">
              <SectionHeader step={5} variant="blue" title="Verify the Rows Were Inserted" phase="Verify" />
              <Card>
                <CodeBlock label="wp-cli — check all redirects">{'wp db query "SELECT id, url_to, header_code, status FROM [DB_PREFIX]rank_math_redirections;"'}</CodeBlock>
                <CodeBlock label="wp-cli — check for any remaining 302s">{'wp db query "SELECT id, url_to, header_code FROM [DB_PREFIX]rank_math_redirections WHERE header_code != 301;"'}</CodeBlock>
                <CodeBlock label="terminal — spot-check a live redirect">{'curl -I https://[SITE_DOMAIN]/[old-url-path]/\n# Look for: HTTP/2 301 and Location: https://[SITE_DOMAIN]/[new-url-path]/'}</CodeBlock>
                <Callout type="success" icon="✓">Also confirm in WP Admin → Rank Math → Redirections. All rows should appear as active 301s.</Callout>
              </Card>
            </div>

            <Divider />

            <div className="mb-9">
              <SectionHeader step="↻" variant="warn" title="Fix Accidental 302s (if needed)" phase="Cleanup" />
              <Card>
                <P>If the DB query above shows any 302s that should be 301s, bulk-update them in one command:</P>
                <CodeBlock label="wp-cli — bulk fix 302 → 301">{'wp db query "UPDATE [DB_PREFIX]rank_math_redirections SET header_code = 301 WHERE header_code = 302;"'}</CodeBlock>
                <CodeBlock label="wp-cli — clear cache after update">{'wp transient delete --all'}</CodeBlock>
                <Sub>Then flush the site cache from WP Admin:</Sub>
                <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
              </Card>
            </div>
          </div>
        )}

        {/* ── WORKFLOW B ── */}
        {workflow === 'b' && (
          <div>
            <Callout type="info" icon="ℹ">
              Use this workflow when a site already has redirects stored in <strong>Safe Redirect Manager</strong> that need to be migrated into Rank Math. The Redirection plugin acts as a temporary bridge — it imports from Safe Redirect Manager, then Rank Math imports directly from Redirection. Both plugins are removed once the migration is complete.
            </Callout>
            <div className="mt-8" />

            <PhaseBanner text="— phase 01   pre-flight checks" />

            <div className="mb-9">
              <SectionHeader step="!" variant="warn" title="Gather Site Variables First" phase="Before anything" />
              <Card>
                <P>Same as Workflow A — confirm these before running any commands.</P>
                <VarTable />
                <Callout type="warn" icon="⚠">Most sites use <strong>wp_</strong> but custom prefixes break the table name. Always confirm with <strong>wp db prefix</strong> before running SQL.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 02   install redirection plugin" />

            <div className="mb-9">
              <SectionHeader step={1} title="SSH In & Install Redirection via WP-CLI" phase="SSH" />
              <Card>
                <CodeBlock label="step 1 — ssh in and navigate">{'ssh [SSH_USER]@[SERVER_IP]\ncd /home/runcloud/webapps/[SITE_NAME]/'}</CodeBlock>
                <CodeBlock label="step 2 — install and activate the plugin">{'wp plugin install redirection --activate'}</CodeBlock>
                <Callout type="danger" icon="⚠">This plugin is <strong>temporary</strong> — it will be removed at the end of this workflow. Do not leave it active on client sites.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 03   import from safe redirect manager" />

            <div className="mb-9">
              <SectionHeader step={2} title="Import Redirects from Safe Redirect Manager" phase="SSH" />
              <Card>
                <CodeBlock label="wp-cli — run the import">{'wp redirection import plugin safe-redirect-manager'}</CodeBlock>
                <Callout type="warn" icon="⚠">If this command returns an error or isn&apos;t recognised, fall back to WP Admin → <strong>Tools → Redirection → Import/Export → Import from plugin → Safe Redirect Manager</strong>. CLI import availability depends on the installed version of Redirection.</Callout>
                <Callout type="success" icon="✓">After importing, spot-check the redirect count looks right before moving on.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 04   import into rank math" />

            <div className="mb-9">
              <SectionHeader step={3} title="Import from Redirection into Rank Math" phase="WP Admin" />
              <Card>
                <P>In WP Admin, navigate to <strong>Rank Math → General Settings → Import &amp; Export</strong>. Under the import section, select <strong>Redirection</strong> as the source and run the import.</P>
                <Callout type="success" icon="✓">Confirm in WP Admin → <strong>Rank Math → Redirections</strong> that the redirect count matches what was in Redirection before proceeding.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 05   verify" />

            <div className="mb-9">
              <SectionHeader step={4} variant="blue" title="Verify the Redirects" phase="Verify" />
              <Card>
                <CodeBlock label="wp-cli — check all redirects">{'wp db query "SELECT id, url_to, header_code, status FROM [DB_PREFIX]rank_math_redirections;"'}</CodeBlock>
                <CodeBlock label="terminal — spot-check a live redirect">{'curl -I https://[SITE_DOMAIN]/[old-url-path]/\n# Look for: HTTP/2 301 and Location: https://[SITE_DOMAIN]/[new-url-path]/'}</CodeBlock>
                <Callout type="success" icon="✓">All rows should appear as active 301s. If you see 302s, use the &quot;Fix Accidental 302s&quot; step below before removing the plugins.</Callout>
              </Card>
            </div>

            <PhaseBanner text="— phase 06   cleanup — remove temporary plugins" />

            <div className="mb-9">
              <SectionHeader step={5} variant="danger" title="Remove Redirection Plugin" phase="SSH" />
              <Card>
                <CodeBlock label="wp-cli — deactivate and delete">{'wp plugin deactivate redirection && wp plugin delete redirection'}</CodeBlock>
                <Callout type="danger" icon="⚠">Do not leave Redirection active. It runs its own redirect logic and will conflict with Rank Math, causing duplicate or unexpected redirect behaviour.</Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step={6} variant="danger" title="Remove Safe Redirect Manager" phase="SSH" />
              <Card>
                <CodeBlock label="wp-cli — deactivate and delete">{'wp plugin deactivate safe-redirect-manager && wp plugin delete safe-redirect-manager'}</CodeBlock>
                <Callout type="danger" icon="⚠">All redirects are now managed by Rank Math. Leaving Safe Redirect Manager active means two plugins are handling the same redirects — remove it entirely.</Callout>
              </Card>
            </div>

            <Divider />

            <div className="mb-9">
              <SectionHeader step="↻" variant="warn" title="Fix Accidental 302s (if needed)" phase="Cleanup" />
              <Card>
                <P>If the verify step above shows any 302s that should be 301s, bulk-update them in one command:</P>
                <CodeBlock label="wp-cli — bulk fix 302 → 301">{'wp db query "UPDATE [DB_PREFIX]rank_math_redirections SET header_code = 301 WHERE header_code = 302;"'}</CodeBlock>
                <CodeBlock label="wp-cli — clear cache after update">{'wp transient delete --all'}</CodeBlock>
                <Sub>Then flush the site cache from WP Admin:</Sub>
                <Callout type="info" icon="🖥">WP Admin → <strong>Rank Math → Status &amp; Tools → Tools tab</strong> → click <strong>&quot;Flush Redirections Cache&quot;</strong><br /><br />If your site uses an additional caching plugin (e.g. WP Rocket, LiteSpeed, W3 Total Cache), flush that cache too from its own menu.</Callout>
              </Card>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-14 pt-5 border-t border-navy-border flex justify-between font-mono text-[10px] text-white/40">
          <span>enrollment resources — internal tooling</span>
          <span>rankmath free &nbsp;·&nbsp; runcloud &nbsp;·&nbsp; wp-cli</span>
        </footer>

      </div>
    </div>
  )
}
