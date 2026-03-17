import Link from 'next/link'

// ─── Tool data ────────────────────────────────────────────────────────────────

const tools = [
  {
    id: 'seo-parser',
    href: '/seo-parser',
    name: 'SEO Parser',
    tagline: 'Analyze. Surface. Act.',
    description:
      'Upload Screaming Frog CSV exports and instantly surface critical SEO issues, prioritized by impact. Get exportable reports and actionable recommendations.',
    features: ['Screaming Frog CSV support', 'Issue priority scoring', 'Markdown / JSON export'],
    icon: ParserIcon,
    accentClass: 'from-orange/20 to-transparent',
  },
  {
    id: 'quarter-grid',
    href: '/quarter-grid',
    name: 'Quarter Grid',
    tagline: 'Plan. Schedule. Execute.',
    description:
      'Drag-and-drop quarterly SEO planning across your full client roster. Schedule 13 weeks of work with priority tiers, snapshots, and JSON export.',
    features: ['Drag-and-drop scheduling', 'Client priority tiers', 'Snapshot save/load'],
    icon: GridIcon,
    accentClass: 'from-orange/20 to-transparent',
    versions: 3,
  },
  {
    id: 'rankmath',
    href: '/rankmath-redirects',
    name: 'RankMath Redirects',
    tagline: 'Migrate. Verify. Done.',
    description:
      'Step-by-step redirect migration workflows for WordPress. Covers fresh RankMath setup and Safe Redirect Manager migrations with CLI-ready commands.',
    features: ['Two workflow variants', 'Copy-ready WP-CLI commands', 'RunCloud integration'],
    icon: RedirectIcon,
    accentClass: 'from-orange/20 to-transparent',
  },
]

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function ParserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      <path d="M12 12h4m-4 4h2" />
    </svg>
  )
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function RedirectIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
      <path d="M5 6l4 4-4 4" opacity={0.4} />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

// ─── Decorative hero visual ───────────────────────────────────────────────────

function HeroVisual() {
  return (
    <div className="relative w-full h-full min-h-[340px] select-none pointer-events-none" aria-hidden>
      {/* Outer glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-64 h-64 rounded-full bg-orange/5 blur-3xl" />
      </div>

      {/* Card 1 — SEO Parser (back left) */}
      <div
        className="absolute top-6 left-4 w-52 rounded-xl bg-white border border-gray-200 shadow-xl p-4"
        style={{ transform: 'rotate(-4deg) translateZ(0)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded bg-orange/15 flex items-center justify-center">
            <ParserIcon className="w-3.5 h-3.5 text-orange" />
          </div>
          <span className="text-[11px] font-display font-bold text-navy">SEO Parser</span>
        </div>
        <div className="space-y-1.5">
          {[
            { label: 'Broken pages', count: '14', color: 'bg-red-400' },
            { label: 'Missing titles', count: '7', color: 'bg-yellow-400' },
            { label: 'Thin content', count: '23', color: 'bg-blue-400' },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${row.color}`} />
                <span className="text-[10px] text-gray-500 font-body">{row.label}</span>
              </div>
              <span className="text-[10px] font-bold text-navy font-display">{row.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Card 2 — Quarter Grid (front center) */}
      <div
        className="absolute top-20 left-1/2 -translate-x-1/2 w-56 rounded-xl bg-navy shadow-2xl p-4 border border-navy-border"
        style={{ transform: 'translateX(-40%) translateZ(0)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded bg-orange/20 flex items-center justify-center">
            <GridIcon className="w-3.5 h-3.5 text-orange" />
          </div>
          <span className="text-[11px] font-display font-bold text-white">Quarter Grid</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className={`h-5 rounded text-[8px] flex items-center justify-center font-bold ${
                i % 5 === 0
                  ? 'bg-orange text-navy'
                  : i % 3 === 0
                  ? 'bg-navy-light text-white/60'
                  : 'bg-navy-card text-white/20'
              }`}
            >
              {i % 5 === 0 ? 'P1' : i % 3 === 0 ? 'P3' : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Card 3 — RankMath (back right) */}
      <div
        className="absolute top-8 right-2 w-48 rounded-xl bg-white border border-gray-200 shadow-xl p-4"
        style={{ transform: 'rotate(3deg) translateZ(0)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded bg-orange/15 flex items-center justify-center">
            <RedirectIcon className="w-3.5 h-3.5 text-orange" />
          </div>
          <span className="text-[11px] font-display font-bold text-navy">Redirects</span>
        </div>
        <div className="space-y-2">
          {['Workflow A', 'Workflow B'].map((wf) => (
            <div key={wf} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-orange flex-shrink-0" />
              <span className="text-[10px] font-body text-gray-500">{wf}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom label */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className="text-[11px] font-body text-gray-400 tracking-wide">
          3 tools · All in one place
        </span>
      </div>
    </div>
  )
}

// ─── Tool Card ────────────────────────────────────────────────────────────────

function ToolCard({
  tool,
}: {
  tool: (typeof tools)[number]
}) {
  const Icon = tool.icon

  return (
    <Link
      href={tool.href}
      className="group relative flex flex-col bg-navy-card rounded-2xl overflow-hidden border border-navy-border hover:border-orange/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
    >
      {/* Orange accent line */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-orange via-orange-light to-orange/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="p-7 flex flex-col flex-1">
        {/* Icon + versions badge */}
        <div className="flex items-start justify-between mb-5">
          <div className="w-12 h-12 rounded-xl bg-orange/15 flex items-center justify-center group-hover:bg-orange/25 transition-colors duration-300">
            <Icon className="w-6 h-6 text-orange" />
          </div>
          {tool.versions && (
            <span className="text-[11px] font-body bg-orange/15 text-orange-light px-2 py-0.5 rounded-full">
              {tool.versions} versions
            </span>
          )}
        </div>

        {/* Name + tagline */}
        <div className="mb-3">
          <h3 className="font-display font-bold text-xl text-white mb-0.5">
            {tool.name}
          </h3>
          <p className="text-[12px] font-body text-orange/70 tracking-wide uppercase font-semibold">
            {tool.tagline}
          </p>
        </div>

        {/* Description */}
        <p className="font-body text-[14px] text-white/55 leading-relaxed mb-6 flex-1">
          {tool.description}
        </p>

        {/* Feature list */}
        <ul className="space-y-2 mb-7">
          {tool.features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <CheckIcon className="w-3.5 h-3.5 text-orange flex-shrink-0" />
              <span className="text-[13px] font-body text-white/60">{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="flex items-center gap-2 text-orange font-body font-semibold text-[14px] group-hover:gap-3 transition-all duration-200">
          Open Tool
          <ArrowIcon className="w-4 h-4" />
        </div>
      </div>
    </Link>
  )
}

// ─── Stats strip ─────────────────────────────────────────────────────────────

const stats = [
  { value: '3', label: 'SEO Tools' },
  { value: 'Next.js 15', label: 'App Router' },
  { value: 'Git', label: 'Connected Deploy' },
  { value: 'RunCloud', label: 'Hosted' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative bg-white dot-grid overflow-hidden">
        {/* Gradient overlay to fade dot grid at edges */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/0 to-white pointer-events-none" />
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-gray-50 to-transparent pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-0">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-0 items-center">

            {/* Left — Content */}
            <div className="lg:pr-12 pb-20">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-orange/10 border border-orange/20 rounded-full px-3.5 py-1.5 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-orange animate-pulse" />
                <span className="text-[12px] font-body font-semibold text-orange tracking-wide uppercase">
                  Internal SEO Toolkit
                </span>
              </div>

              {/* Headline */}
              <h1 className="font-display font-extrabold text-[44px] sm:text-[52px] leading-[1.05] text-navy mb-6">
                Your Complete{' '}
                <span className="text-orange relative">
                  SEO Toolkit
                  {/* Underline accent */}
                  <svg
                    className="absolute -bottom-1 left-0 w-full"
                    viewBox="0 0 300 8"
                    fill="none"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M2 6C60 2 120 1 180 3C240 5 270 6 298 5"
                      stroke="#f5a623"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                {' '}—{' '}
                <span className="text-navy/70">All in One Place.</span>
              </h1>

              <p className="font-body text-[17px] text-navy/55 leading-relaxed mb-10 max-w-[440px]">
                Purpose-built tools for enrollment marketers and web teams. Audit sites, plan quarters, migrate redirects — without switching between scattered files.
              </p>

              {/* Quick jump pills */}
              <div className="flex flex-wrap gap-3">
                {tools.map((tool) => (
                  <Link
                    key={tool.id}
                    href={tool.href}
                    className="inline-flex items-center gap-2 bg-navy text-white text-[13px] font-body font-semibold px-4 py-2.5 rounded-lg hover:bg-navy-light transition-colors duration-200 shadow-sm"
                  >
                    <tool.icon className="w-4 h-4 text-orange" />
                    {tool.name}
                  </Link>
                ))}
              </div>
            </div>

            {/* Right — Decorative visual */}
            <div className="hidden lg:block">
              <HeroVisual />
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="relative bg-navy">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
              {stats.map((s) => (
                <div key={s.label} className="px-6 py-5 text-center">
                  <div className="font-display font-extrabold text-[22px] text-orange mb-0.5">
                    {s.value}
                  </div>
                  <div className="font-body text-[12px] text-white/45 uppercase tracking-widest">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tools grid ─────────────────────────────────────────────── */}
      <section className="bg-navy grid-lines py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">

          {/* Section header */}
          <div className="max-w-xl mb-14">
            <p className="text-[11px] font-body font-semibold text-orange/70 uppercase tracking-[0.2em] mb-3">
              The Toolkit
            </p>
            <h2 className="font-display font-extrabold text-[34px] sm:text-[40px] text-white leading-tight mb-4">
              Everything you need,<br />in one place.
            </h2>
            <p className="font-body text-[15px] text-white/45 leading-relaxed">
              Three tools built specifically for the SEO workflows at Enrollment Resources. No login, no subscriptions — just open and go.
            </p>
          </div>

          {/* Cards */}
          <div className="grid md:grid-cols-3 gap-5">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Quick links / "get started" ────────────────────────────── */}
      <section className="bg-navy-deep py-16 border-t border-navy-border/30">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="font-display font-bold text-[26px] text-white mb-3">
            Ready to get started?
          </h2>
          <p className="font-body text-[15px] text-white/45 mb-8">
            Pick a tool and open it directly — no setup required.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/seo-parser"
              className="inline-flex items-center gap-2 bg-orange text-navy font-display font-bold text-[14px] px-6 py-3 rounded-lg hover:bg-orange-light transition-colors duration-200 shadow-lg"
            >
              <ParserIcon className="w-4 h-4" />
              Open SEO Parser
            </Link>
            <Link
              href="/quarter-grid"
              className="inline-flex items-center gap-2 bg-white/10 text-white font-display font-semibold text-[14px] px-6 py-3 rounded-lg hover:bg-white/15 transition-colors duration-200 border border-white/10"
            >
              <GridIcon className="w-4 h-4 text-orange" />
              Open Quarter Grid
            </Link>
            <Link
              href="/rankmath-redirects"
              className="inline-flex items-center gap-2 bg-white/10 text-white font-display font-semibold text-[14px] px-6 py-3 rounded-lg hover:bg-white/15 transition-colors duration-200 border border-white/10"
            >
              <RedirectIcon className="w-4 h-4 text-orange" />
              RankMath Redirects
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
