'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { THEMES, type ThemeId, buildPreviewSrcDoc } from './preview-themes'

interface Preset {
  name: string
  group: 'tailwind' | 'daisyui'
  html: string
}

const PRESETS: Preset[] = [
  // Plain Tailwind
  {
    name: 'Tailwind button',
    group: 'tailwind',
    html: `<button class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
  Save changes
</button>`,
  },
  {
    name: 'Card',
    group: 'tailwind',
    html: `<article class="max-w-sm rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-900/5 hover:shadow-lg transition-shadow">
  <h3 class="text-lg font-semibold text-slate-900">Card title</h3>
  <p class="mt-2 text-sm text-slate-600">A short description that explains the card.</p>
  <a href="#" class="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
    Learn more →
  </a>
</article>`,
  },
  {
    name: 'Hero',
    group: 'tailwind',
    html: `<section class="bg-gradient-to-b from-slate-50 to-white">
  <div class="mx-auto max-w-3xl px-4 py-16 text-center">
    <h1 class="text-3xl md:text-5xl font-bold tracking-tight text-slate-900">
      Build sites faster.
    </h1>
    <p class="mx-auto mt-4 max-w-xl text-base text-slate-600">
      Oxygen + Tailwind gives you full control over your markup and your design system.
    </p>
    <div class="mt-8 flex items-center justify-center gap-3">
      <a class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm text-white font-medium hover:bg-blue-700">
        Get started
      </a>
      <a class="text-sm text-slate-700 hover:text-slate-900">Learn more →</a>
    </div>
  </div>
</section>`,
  },
  {
    name: 'Grid',
    group: 'tailwind',
    html: `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-2xl">
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">1</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">2</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">3</div>
  <div class="rounded-lg bg-blue-200 p-4 text-center text-blue-900 font-medium col-span-2">4–5</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">6</div>
</div>`,
  },

  // DaisyUI (matches the FusionCore bundle on production)
  {
    name: 'DaisyUI buttons',
    group: 'daisyui',
    html: `<div class="flex flex-wrap gap-2">
  <button class="btn">Default</button>
  <button class="btn btn-primary">Primary</button>
  <button class="btn btn-secondary">Secondary</button>
  <button class="btn btn-accent">Accent</button>
  <button class="btn btn-ghost">Ghost</button>
  <button class="btn btn-link">Link</button>
  <button class="btn btn-outline btn-primary">Outline</button>
  <button class="btn btn-disabled">Disabled</button>
</div>`,
  },
  {
    name: 'DaisyUI card',
    group: 'daisyui',
    html: `<div class="card bg-base-100 w-80 shadow-sm">
  <div class="card-body">
    <h2 class="card-title">Welcome</h2>
    <p>DaisyUI cards combine layout, padding, and typography into one component.</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Get started</button>
    </div>
  </div>
</div>`,
  },
  {
    name: 'DaisyUI form',
    group: 'daisyui',
    html: `<fieldset class="fieldset bg-base-100 p-6 rounded-box w-80 border border-base-300">
  <legend class="fieldset-legend">Sign in</legend>
  <label class="label">Email</label>
  <input type="email" class="input w-full" placeholder="you@example.com" />
  <label class="label mt-2">Password</label>
  <input type="password" class="input w-full" placeholder="••••••" />
  <label class="label mt-3 cursor-pointer">
    <input type="checkbox" class="checkbox checkbox-sm" checked />
    <span>Remember me</span>
  </label>
  <button class="btn btn-primary mt-3">Sign in</button>
</fieldset>`,
  },
  {
    name: 'DaisyUI alerts',
    group: 'daisyui',
    html: `<div class="space-y-2 max-w-md">
  <div class="alert alert-info">Heads up — info message.</div>
  <div class="alert alert-success">Saved successfully.</div>
  <div class="alert alert-warning">Check before you publish.</div>
  <div class="alert alert-error">Something broke.</div>
</div>`,
  },
  {
    name: 'House tokens',
    group: 'daisyui',
    html: `<!-- Brand tokens shipped via FusionCore: bg-primary, text-primary, bg-secondary, bg-tertiary, font-headings -->
<div class="space-y-3 max-w-md">
  <div class="bg-primary text-white p-4 rounded-lg">
    <span class="font-headings text-lg font-semibold">primary surface</span>
  </div>
  <div class="bg-secondary text-white p-4 rounded-lg">
    <span class="font-headings text-lg font-semibold">secondary surface</span>
  </div>
  <div class="bg-tertiary text-black p-4 rounded-lg">
    <span class="font-headings text-lg font-semibold">tertiary (accent) surface</span>
  </div>
</div>`,
  },
]


export function Playground() {
  const [code, setCode] = useState<string>(PRESETS[0].html)
  const [debounced, setDebounced] = useState<string>(code)
  const [theme, setTheme] = useState<ThemeId>('pro-way')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(code), 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [code])

  const srcDoc = useMemo(() => buildPreviewSrcDoc(debounced, theme), [debounced, theme])

  return (
    <div className="bg-navy-card border border-navy-border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-navy-border bg-[#0f1118]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase mr-1">
            Tailwind:
          </span>
          {PRESETS.filter((p) => p.group === 'tailwind').map((p) => (
            <button
              key={p.name}
              onClick={() => setCode(p.html)}
              className="font-mono text-[10px] tracking-wide uppercase border border-navy-border bg-transparent text-white/55 hover:text-white hover:border-orange/50 rounded px-2 py-0.5 transition-colors"
            >
              {p.name.replace(/^Tailwind /, '')}
            </button>
          ))}
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase ml-3 mr-1">
            DaisyUI:
          </span>
          {PRESETS.filter((p) => p.group === 'daisyui').map((p) => (
            <button
              key={p.name}
              onClick={() => setCode(p.html)}
              className="font-mono text-[10px] tracking-wide uppercase border border-navy-border bg-transparent text-white/55 hover:text-white hover:border-purple-500/50 rounded px-2 py-0.5 transition-colors"
            >
              {p.name.replace(/^DaisyUI /, '')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase mr-1">
            Theme:
          </span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.hint}
              className={`font-mono text-[10px] uppercase border rounded px-2 py-0.5 transition-colors ${
                theme === t.id
                  ? 'border-orange text-orange'
                  : 'border-navy-border text-white/40 hover:text-white/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Editor + preview */}
      <div className="grid md:grid-cols-2">
        <div className="border-r border-navy-border bg-[#0a0c10]">
          <div className="px-4 py-2 border-b border-navy-border bg-[#0f1118] font-mono text-[10px] text-white/40 tracking-widest uppercase">
            HTML + Tailwind classes
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[360px] resize-y bg-[#0a0c10] text-white/80 font-mono text-[12px] leading-relaxed p-4 outline-none focus:bg-[#0d0f15]"
            placeholder="Type any HTML with Tailwind classes here…"
          />
        </div>
        <div>
          <div className="px-4 py-2 border-b border-navy-border bg-[#0f1118] font-mono text-[10px] text-white/40 tracking-widest uppercase flex items-center justify-between">
            <span>Live preview</span>
            <span className="text-white/30">Tailwind Play CDN</span>
          </div>
          <iframe
            title="Tailwind preview"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            className="w-full min-h-[360px] bg-white"
          />
        </div>
      </div>

      <div className="px-4 py-2 border-t border-navy-border bg-[#0f1118] font-mono text-[10px] text-white/40 leading-relaxed">
        Edits debounced 350ms · sandboxed iframe · Tailwind v4 (
        <code className="text-orange">@tailwindcss/browser@4</code>) +{' '}
        <code className="text-purple-300">daisyui@5</code> via CDN — same versions as the
        FusionCore production bundle. Switch the theme to see how the same markup renders
        across different brand-token sets.
      </div>
    </div>
  )
}
