'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { THEMES, type ThemeId, buildPreviewSrcDoc } from './preview-themes'

interface DaisyClass {
  name: string
  use: string
}

interface DaisyExample {
  label: string
  code: string
}

interface DaisyCategory {
  id: string
  title: string
  intro: string
  classes: DaisyClass[]
  examples: DaisyExample[]
}

const CATEGORIES: DaisyCategory[] = [
  {
    id: 'daisy-buttons',
    title: 'Buttons',
    intro:
      'The .btn class is the workhorse. Color variants, sizes, and shapes layer on as additional modifier classes.',
    classes: [
      { name: '.btn',                use: 'Base button. Required on every variant.' },
      { name: '.btn-primary',        use: 'Brand primary color (resolves to your client\'s primary token).' },
      { name: '.btn-secondary',      use: 'Brand secondary color.' },
      { name: '.btn-accent',         use: 'Accent / call-to-action color.' },
      { name: '.btn-neutral',        use: 'Neutral surface (greyscale).' },
      { name: '.btn-ghost',          use: 'Transparent background, only visible on hover.' },
      { name: '.btn-link',           use: 'Renders like a link — underlined, no background.' },
      { name: '.btn-outline',        use: 'Modifier — outline-only variant of any color (chain with .btn-primary etc).' },
      { name: '.btn-soft',           use: 'Modifier — soft / tinted variant.' },
      { name: '.btn-info / .btn-success / .btn-warning / .btn-error', use: 'Status colors.' },
      { name: '.btn-xs / .btn-sm / .btn-md / .btn-lg / .btn-xl', use: 'Sizes.' },
      { name: '.btn-wide / .btn-block', use: 'Wider / full-width.' },
      { name: '.btn-square / .btn-circle', use: 'Icon-only shapes.' },
      { name: '.btn-disabled / [disabled]', use: 'Disabled state.' },
    ],
    examples: [
      {
        label: 'color variants',
        code: `<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-accent">Accent</button>
<button class="btn btn-ghost">Ghost</button>
<button class="btn btn-link">Link</button>`,
      },
      {
        label: 'icon button (square)',
        code: `<button class="btn btn-square btn-primary">
  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">…</svg>
</button>`,
      },
    ],
  },
  {
    id: 'daisy-forms',
    title: 'Forms & inputs',
    intro:
      'Form controls are individual classes per element type. Wrap groups in a fieldset for legend + spacing.',
    classes: [
      { name: '.input',          use: 'Text inputs of any type (text, email, password, search, number…).' },
      { name: '.select',         use: 'Dropdown <select>.' },
      { name: '.textarea',       use: 'Multi-line text input.' },
      { name: '.checkbox',       use: 'Styled <input type="checkbox">.' },
      { name: '.radio',          use: 'Styled <input type="radio">.' },
      { name: '.toggle',         use: 'iOS-style switch (also on type="checkbox").' },
      { name: '.range',          use: 'Slider <input type="range">.' },
      { name: '.file-input',     use: 'File picker.' },
      { name: '.fieldset',       use: 'Wrapper that gives a group spacing + a legend slot.' },
      { name: '.fieldset-legend', use: 'Title row inside a .fieldset.' },
      { name: '.label',          use: 'Form label row.' },
      { name: '.input-primary / -secondary / -accent / -info / -success / -warning / -error', use: 'Color border tinting (chain with the base class).' },
      { name: '.input-xs / -sm / -md / -lg', use: 'Sizes (apply to input/select/textarea).' },
      { name: '.input-bordered / .input-ghost', use: 'Bordered (default in v5) / borderless variants.' },
      { name: '.validator',      use: 'Adds the browser native validation styling hooks.' },
    ],
    examples: [
      {
        label: 'fieldset with input + checkbox',
        code: `<fieldset class="fieldset bg-base-100 p-6 rounded-box border border-base-300">
  <legend class="fieldset-legend">Profile</legend>
  <label class="label">Name</label>
  <input type="text" class="input w-full" placeholder="Jane Doe" />
  <label class="label mt-3 cursor-pointer">
    <input type="checkbox" class="toggle toggle-primary" checked />
    <span>Email me updates</span>
  </label>
</fieldset>`,
      },
      {
        label: 'select + range',
        code: `<select class="select select-bordered w-full max-w-xs">
  <option disabled selected>Pick a tier</option>
  <option>Starter</option>
  <option>Pro</option>
</select>
<input type="range" min="0" max="100" value="40" class="range range-primary" />`,
      },
    ],
  },
  {
    id: 'daisy-layout',
    title: 'Cards & layout',
    intro:
      'Layout primitives that bundle a sensible default look — saves you from rebuilding the same card/hero markup every time.',
    classes: [
      { name: '.card',            use: 'Rounded panel with shadow + base background. Most common content container.' },
      { name: '.card-body',       use: 'Inner padding section of a .card.' },
      { name: '.card-title',      use: 'Title row inside .card-body (heading style).' },
      { name: '.card-actions',    use: 'Right-aligned actions row (buttons) at the bottom of a card.' },
      { name: '.card-side',       use: 'Modifier — image on the side instead of top.' },
      { name: '.card-bordered',   use: 'Modifier — adds border instead of (or with) shadow.' },
      { name: '.hero',            use: 'Full-width centered hero block. Pair with .hero-content.' },
      { name: '.hero-content',    use: 'Inner content wrapper inside a .hero.' },
      { name: '.divider',         use: 'Horizontal rule with optional centered text. Vertical with .divider-horizontal.' },
      { name: '.collapse',        use: 'Show/hide block triggered by a checkbox or details element.' },
      { name: '.collapse-title / .collapse-content', use: 'Inner parts of a collapse.' },
      { name: '.stack',           use: 'Stacks children on top of each other (deck of cards effect).' },
      { name: '.mockup-window / .mockup-browser / .mockup-phone / .mockup-code', use: 'Decorative frames — useful for screenshots in docs.' },
      { name: '.indicator',       use: 'Anchor a small badge to the corner of an element (e.g. notification dot).' },
      { name: '.join',            use: 'Visually joins inline children into a single rounded group (e.g. button bar).' },
    ],
    examples: [
      {
        label: 'card with actions',
        code: `<div class="card bg-base-100 w-80 shadow-sm">
  <figure><img src="…" alt="" /></figure>
  <div class="card-body">
    <h2 class="card-title">Welcome</h2>
    <p>Description text goes here.</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Apply</button>
    </div>
  </div>
</div>`,
      },
      {
        label: 'hero',
        code: `<section class="hero min-h-[40vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold font-headings">Welcome to Pro Way</h1>
      <p class="py-6">Career-focused programs in cosmetology and barbering.</p>
      <button class="btn btn-primary">Apply Now</button>
    </div>
  </div>
</section>`,
      },
    ],
  },
  {
    id: 'daisy-navigation',
    title: 'Navigation',
    intro:
      'Menus, tabs, navbars, breadcrumbs. These are the components your team reaches for on every page.',
    classes: [
      { name: '.navbar',          use: 'Horizontal top bar with .navbar-start / .navbar-center / .navbar-end slots.' },
      { name: '.menu',            use: 'Vertical or horizontal navigation list. Modifier classes change layout/size.' },
      { name: '.menu-horizontal / .menu-vertical', use: 'Direction.' },
      { name: '.menu-xs / -sm / -md / -lg', use: 'Sizes.' },
      { name: '.menu-title',      use: 'Section header inside a menu.' },
      { name: '.tabs / .tab',     use: 'Tabbed interface. Add .tab-active to the current tab.' },
      { name: '.tabs-boxed / -lifted / -bordered', use: 'Visual variants.' },
      { name: '.breadcrumbs',     use: 'Path indicator with auto separators.' },
      { name: '.steps / .step',   use: 'Wizard / progress step indicator. Add .step-primary for completed.' },
      { name: '.link',            use: 'Inline anchor styled as a link with hover underline.' },
      { name: '.link-primary / -secondary / -accent / -hover', use: 'Color and behavior modifiers.' },
      { name: '.dock',            use: 'Bottom mobile navigation bar.' },
      { name: '.pagination',      use: 'Numbered page selector (use with .join).' },
    ],
    examples: [
      {
        label: 'navbar',
        code: `<div class="navbar bg-base-100 shadow-sm">
  <div class="navbar-start">
    <a class="btn btn-ghost text-xl font-headings">Pro Way</a>
  </div>
  <div class="navbar-center hidden lg:flex">
    <ul class="menu menu-horizontal px-1">
      <li><a>Programs</a></li>
      <li><a>Admissions</a></li>
      <li><a>About</a></li>
    </ul>
  </div>
  <div class="navbar-end">
    <a class="btn btn-primary">Apply</a>
  </div>
</div>`,
      },
      {
        label: 'tabs',
        code: `<div role="tablist" class="tabs tabs-bordered">
  <a role="tab" class="tab tab-active">Overview</a>
  <a role="tab" class="tab">Curriculum</a>
  <a role="tab" class="tab">Tuition</a>
</div>`,
      },
      {
        label: 'breadcrumbs',
        code: `<nav class="breadcrumbs text-sm">
  <ul>
    <li><a>Home</a></li>
    <li><a>Programs</a></li>
    <li>Cosmetology</li>
  </ul>
</nav>`,
      },
    ],
  },
  {
    id: 'daisy-feedback',
    title: 'Feedback & status',
    intro:
      'Alerts, badges, tooltips, progress bars — components that surface state and progress to the user.',
    classes: [
      { name: '.alert',           use: 'Inline status banner. Pair with semantic colors.' },
      { name: '.alert-info / -success / -warning / -error', use: 'Semantic color variants.' },
      { name: '.alert-soft / -outline / -dash', use: 'Visual style modifiers.' },
      { name: '.badge',           use: 'Small label / counter pill.' },
      { name: '.badge-primary / -secondary / -accent / -info / -success / -warning / -error', use: 'Color variants.' },
      { name: '.badge-outline / -soft', use: 'Style variants.' },
      { name: '.badge-xs / -sm / -md / -lg', use: 'Sizes.' },
      { name: '.loading',         use: 'Animated loading indicator. Add a shape modifier.' },
      { name: '.loading-spinner / -dots / -ring / -ball / -bars / -infinity', use: 'Loader shapes.' },
      { name: '.tooltip',         use: 'Hover tooltip wrapper. Set the text via data-tip attribute.' },
      { name: '.tooltip-top / -bottom / -left / -right', use: 'Direction.' },
      { name: '.progress',        use: 'Determinate progress bar (use <progress> element).' },
      { name: '.skeleton',        use: 'Pulsing placeholder shape — loading state for content blocks.' },
      { name: '.toast',           use: 'Floating notification region (typically fixed-positioned).' },
      { name: '.modal / .modal-box', use: 'Dialog. Open with the open attribute or :target.' },
      { name: '.status',          use: 'Tiny dot indicator (online/offline). Pair with size + color.' },
    ],
    examples: [
      {
        label: 'alerts',
        code: `<div class="alert alert-info">Heads up — info message.</div>
<div class="alert alert-success">Saved successfully.</div>
<div class="alert alert-warning">Check before you publish.</div>
<div class="alert alert-error">Something broke.</div>`,
      },
      {
        label: 'badges + tooltip',
        code: `<span class="badge badge-success">Active</span>
<span class="badge badge-warning badge-outline">Pending</span>
<span class="tooltip tooltip-top" data-tip="Last updated 5min ago">
  <button class="btn btn-sm btn-ghost">Status</button>
</span>`,
      },
      {
        label: 'loading + progress',
        code: `<span class="loading loading-spinner loading-md text-primary"></span>
<progress class="progress progress-primary w-56" value="40" max="100"></progress>
<div class="skeleton h-4 w-32"></div>`,
      },
    ],
  },
  {
    id: 'daisy-data',
    title: 'Data display',
    intro:
      'Avatars, stats, tables, timelines — components for presenting structured information.',
    classes: [
      { name: '.avatar',          use: 'Wraps an image / initials in a circular or rounded frame.' },
      { name: '.avatar-online / -offline / -placeholder', use: 'Status modifiers.' },
      { name: '.avatar-group',    use: 'Overlapping stack of avatars.' },
      { name: '.stat / .stats',   use: '.stats is the container, each .stat is one tile (label + figure + desc).' },
      { name: '.stat-title / -value / -desc / -figure / -actions', use: 'Inner parts of a .stat tile.' },
      { name: '.table',           use: 'Styled table. Add zebra rows with .table-zebra; sizes with .table-xs..-lg.' },
      { name: '.timeline',        use: 'Vertical or horizontal event timeline.' },
      { name: '.timeline-start / -middle / -end', use: 'Event anchor positions.' },
      { name: '.chat / .chat-bubble', use: 'Chat-message style container.' },
      { name: '.chat-start / -end', use: 'Direction.' },
      { name: '.list',            use: 'Vertical list with row-based layout.' },
      { name: '.kbd',             use: 'Keyboard key styled as a key cap.' },
      { name: '.diff',            use: 'Side-by-side image / content comparison.' },
      { name: '.countdown',       use: 'Animated number countdown (CSS only).' },
    ],
    examples: [
      {
        label: 'stats',
        code: `<div class="stats shadow">
  <div class="stat">
    <div class="stat-title">Enrolled</div>
    <div class="stat-value text-primary">412</div>
    <div class="stat-desc">↗︎ 24 this week</div>
  </div>
  <div class="stat">
    <div class="stat-title">Graduation rate</div>
    <div class="stat-value">86%</div>
    <div class="stat-desc">vs. 79% YoY</div>
  </div>
</div>`,
      },
      {
        label: 'table',
        code: `<table class="table table-zebra">
  <thead>
    <tr><th></th><th>Program</th><th>Length</th><th>Tuition</th></tr>
  </thead>
  <tbody>
    <tr><th>1</th><td>Cosmetology</td><td>1500h</td><td>$18,000</td></tr>
    <tr><th>2</th><td>Barbering</td><td>1200h</td><td>$14,500</td></tr>
  </tbody>
</table>`,
      },
      {
        label: 'avatar group',
        code: `<div class="avatar-group -space-x-3">
  <div class="avatar"><div class="w-10 rounded-full"><img src="…" alt="" /></div></div>
  <div class="avatar"><div class="w-10 rounded-full"><img src="…" alt="" /></div></div>
  <div class="avatar avatar-placeholder">
    <div class="w-10 rounded-full bg-neutral text-neutral-content"><span>+8</span></div>
  </div>
</div>`,
      },
    ],
  },
]

// Inline SVG placeholder used in previews wherever the documented examples use `src="…"`.
// Keeps the documented HTML readable while making previews render with real-looking images.
const PLACEHOLDER_IMG_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">
       <defs>
         <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0%" stop-color="#94a3b8"/>
           <stop offset="100%" stop-color="#475569"/>
         </linearGradient>
       </defs>
       <rect width="200" height="150" fill="url(#g)"/>
       <circle cx="100" cy="60" r="20" fill="#fff" opacity="0.6"/>
       <path d="M40 130 Q100 80 160 130" fill="none" stroke="#fff" stroke-width="6" opacity="0.6"/>
     </svg>`
  )

function swapPlaceholders(html: string): string {
  // Replace src="…" (with the ellipsis char) — documented as the canonical image placeholder.
  return html.replace(/src="…"/g, `src="${PLACEHOLDER_IMG_DATA_URL}"`)
}

function buildCategoryPreviewHtml(examples: DaisyExample[]): string {
  return `<div class="space-y-5">
${examples
  .map(
    (ex) => `  <div>
    <div class="text-[10px] uppercase tracking-widest text-base-content/50 mb-1.5 font-mono">${escapeHtml(ex.label)}</div>
    <div class="rounded-lg bg-base-100 p-4 border border-base-300">
${swapPlaceholders(ex.code)}
    </div>
  </div>`
  )
  .join('\n')}
</div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface LazyPreviewProps {
  examples: DaisyExample[]
}

function LazyPreview({ examples }: LazyPreviewProps) {
  const [theme, setTheme] = useState<ThemeId>('pro-way')
  const [visible, setVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (visible) return
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '300px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  const innerHtml = useMemo(() => buildCategoryPreviewHtml(examples), [examples])
  const srcDoc = useMemo(
    () => (visible ? buildPreviewSrcDoc(innerHtml, theme, { centered: false }) : ''),
    [visible, innerHtml, theme]
  )

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-navy-border overflow-hidden mb-3 bg-[#0a0c10]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-navy-border bg-[#0f1118]">
        <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">
          Live preview
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-mono text-[10px] text-white/30 tracking-wider uppercase mr-1">
            Theme:
          </span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.hint}
              className={`font-mono text-[9px] uppercase border rounded px-1.5 py-0.5 transition-colors ${
                theme === t.id
                  ? 'border-purple-400 text-purple-300'
                  : 'border-navy-border text-white/40 hover:text-white/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {visible ? (
        <iframe
          title="DaisyUI live preview"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="w-full h-[380px] bg-white"
        />
      ) : (
        <div className="h-[380px] flex items-center justify-center text-white/30 font-mono text-[11px]">
          Preview loads when scrolled into view…
        </div>
      )}
    </div>
  )
}

function CodeWithCopy({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const handleCopy = () => {
    const text = preRef.current?.innerText ?? ''
    navigator.clipboard.writeText(text.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  return (
    <div className="rounded-lg bg-[#0a0c10] border border-navy-border mt-3 overflow-hidden">
      <div className="flex justify-between items-center px-3 py-1.5 border-b border-navy-border bg-[#0f1118]">
        <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">
          {label}
        </span>
        <button
          onClick={handleCopy}
          className={`font-mono text-[10px] uppercase border rounded px-2 py-0.5 ${
            copied
              ? 'text-orange border-orange'
              : 'text-white/40 border-navy-border hover:text-white/60'
          }`}
        >
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        className="font-mono text-[11px] leading-relaxed p-3 text-white/70 whitespace-pre-wrap break-all m-0"
      >
        {code}
      </pre>
    </div>
  )
}

function CategoryCard({ category }: { category: DaisyCategory }) {
  return (
    <div
      id={category.id}
      className="bg-navy-card border border-navy-border rounded-xl p-5 scroll-mt-24"
    >
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-display font-bold text-[15px] text-white m-0">{category.title}</h3>
        <span className="font-mono text-[10px] text-purple-300 bg-purple-500/15 border border-purple-500/30 rounded px-1.5 py-0.5 uppercase tracking-wider">
          DaisyUI
        </span>
      </div>
      <p className="text-[13px] text-white/65 leading-relaxed mb-4">{category.intro}</p>

      <LazyPreview examples={category.examples} />

      <div className="rounded-lg border border-navy-border overflow-hidden mb-3">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead>
            <tr className="bg-[#0f1118]">
              <th className="text-left text-white/40 font-normal tracking-widest uppercase text-[10px] px-3 py-2 border-b border-navy-border w-[38%]">
                Class
              </th>
              <th className="text-left text-white/40 font-normal tracking-widest uppercase text-[10px] px-3 py-2 border-b border-navy-border">
                Use case
              </th>
            </tr>
          </thead>
          <tbody>
            {category.classes.map((c, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-navy-card/40' : ''}>
                <td className="px-3 py-1.5 border-b border-navy-border/50 text-purple-300 align-top">
                  {c.name}
                </td>
                <td className="px-3 py-1.5 border-b border-navy-border/50 text-white/60">
                  {c.use}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {category.examples.map((ex, i) => (
        <CodeWithCopy key={i} label={ex.label} code={ex.code} />
      ))}
    </div>
  )
}

export const DAISY_CATEGORY_IDS = CATEGORIES.map((c) => ({ id: c.id, title: c.title }))

export function DaisyComponentsSection() {
  return (
    <div className="space-y-4">
      {CATEGORIES.map((c) => (
        <CategoryCard key={c.id} category={c} />
      ))}
    </div>
  )
}
