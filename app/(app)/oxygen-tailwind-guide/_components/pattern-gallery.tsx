'use client'

import { useState } from 'react'

interface Pattern {
  name: string
  description: string
  preview: React.ReactNode
  code: string
  bg?: 'light' | 'gradient' | 'dark'
}

// Note: every Tailwind class used in `code` strings below also appears in the matching
// `preview` JSX so the JIT picks them up. Don't rename one without updating the other.

const PATTERNS: Pattern[] = [
  {
    name: 'Primary button',
    description: 'Solid background, hover/active darken, focus-visible ring, disabled state.',
    bg: 'light',
    preview: (
      <button className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
        Save changes
      </button>
    ),
    code: `<button class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
  Save changes
</button>`,
  },
  {
    name: 'Secondary button',
    description: 'Bordered, white background, subtle hover. Use as the cancel/dismiss pair.',
    bg: 'light',
    preview: (
      <button className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Cancel
      </button>
    ),
    code: `<button class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
  Cancel
</button>`,
  },
  {
    name: 'Card',
    description: 'Rounded panel, subtle ring, lift on hover. Most common content container.',
    bg: 'light',
    preview: (
      <article className="max-w-xs rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-900/5 hover:shadow-lg transition-shadow">
        <h3 className="text-lg font-semibold text-slate-900">Card title</h3>
        <p className="mt-2 text-sm text-slate-600">A short description that explains the card.</p>
        <a href="#" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
          Learn more →
        </a>
      </article>
    ),
    code: `<article class="rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-900/5 hover:shadow-lg transition-shadow">
  <h3 class="text-lg font-semibold text-slate-900">Card title</h3>
  <p class="mt-2 text-sm text-slate-600">A short description that explains the card.</p>
  <a href="#" class="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
    Learn more →
  </a>
</article>`,
  },
  {
    name: 'Sticky top nav',
    description: 'Translucent background with backdrop blur — sits on top of any page.',
    bg: 'light',
    preview: (
      <header className="w-full border-b border-slate-200 bg-white/80 backdrop-blur rounded-md">
        <div className="flex items-center justify-between px-4 py-3">
          <a href="#" className="text-base font-bold text-slate-900">Acme</a>
          <nav className="hidden sm:flex items-center gap-5 text-sm font-medium text-slate-700">
            <a href="#" className="hover:text-slate-900">Features</a>
            <a href="#" className="hover:text-slate-900">Pricing</a>
            <a href="#" className="hover:text-slate-900">About</a>
          </nav>
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">Sign in</button>
        </div>
      </header>
    ),
    code: `<header class="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/80 backdrop-blur">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
    <a href="/" class="text-lg font-bold">Acme</a>
    <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700">
      <a href="#" class="hover:text-slate-900">Features</a>
      <a href="#" class="hover:text-slate-900">Pricing</a>
      <a href="#" class="hover:text-slate-900">About</a>
    </nav>
    <button class="md:hidden">☰</button>
  </div>
</header>`,
  },
  {
    name: 'Hero section',
    description: 'Centered headline + lead + CTA pair on a soft gradient background.',
    bg: 'gradient',
    preview: (
      <section className="w-full bg-gradient-to-b from-slate-50 to-white rounded-md">
        <div className="px-4 py-10 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Build sites faster.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
            Oxygen + Tailwind gives you full control over your markup and design system.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <a className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white font-medium hover:bg-blue-700">
              Get started
            </a>
            <a className="text-sm text-slate-700 hover:text-slate-900">Learn more →</a>
          </div>
        </div>
      </section>
    ),
    code: `<section class="relative isolate overflow-hidden bg-gradient-to-b from-slate-50 to-white">
  <div class="mx-auto max-w-7xl px-4 py-24 text-center">
    <h1 class="text-4xl md:text-6xl font-bold tracking-tight text-slate-900">
      Build sites faster.
    </h1>
    <p class="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
      Oxygen + Tailwind gives you full control over your markup and your design system.
    </p>
    <div class="mt-10 flex items-center justify-center gap-4">
      <a class="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700">
        Get started
      </a>
      <a class="text-slate-700 hover:text-slate-900">Learn more →</a>
    </div>
  </div>
</section>`,
  },
  {
    name: 'Form input',
    description: 'Labeled input with focus ring. Pattern repeats for password, email, etc.',
    bg: 'light',
    preview: (
      <label className="block max-w-xs w-full">
        <span className="block text-sm font-medium text-slate-700">Email</span>
        <input
          type="email"
          placeholder="you@example.com"
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
    ),
    code: `<label class="block">
  <span class="block text-sm font-medium text-slate-700">Email</span>
  <input type="email" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
</label>`,
  },
  {
    name: 'Stat tile',
    description: 'Big number, small label. Use in a grid for dashboards or marketing pages.',
    bg: 'light',
    preview: (
      <div className="rounded-lg bg-white p-5 ring-1 ring-slate-900/5 max-w-[180px] w-full">
        <div className="text-3xl font-bold text-slate-900">98.6%</div>
        <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Uptime</div>
      </div>
    ),
    code: `<div class="rounded-lg bg-white p-5 ring-1 ring-slate-900/5">
  <div class="text-3xl font-bold text-slate-900">98.6%</div>
  <div class="mt-1 text-xs uppercase tracking-wider text-slate-500">Uptime</div>
</div>`,
  },
  {
    name: 'Badge / pill',
    description: 'Compact status indicator — soft background, semantic color.',
    bg: 'light',
    preview: (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
          Active
        </span>
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Pending
        </span>
        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
          Failed
        </span>
      </div>
    ),
    code: `<span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
  Active
</span>`,
  },
]

function PatternCard({ pattern }: { pattern: Pattern }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(pattern.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const bgClass =
    pattern.bg === 'gradient'
      ? 'bg-gradient-to-br from-slate-100 to-slate-50'
      : pattern.bg === 'dark'
      ? 'bg-slate-900'
      : 'bg-slate-100'

  return (
    <div className="bg-navy-card border border-navy-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-border bg-[#0f1118] flex justify-between items-start gap-4">
        <div>
          <div className="font-display font-bold text-[14px] text-white">{pattern.name}</div>
          <div className="text-[11px] text-white/50 font-body mt-0.5">{pattern.description}</div>
        </div>
        <button
          onClick={handleCopy}
          className={`flex-shrink-0 font-mono text-[10px] uppercase border rounded px-2.5 py-1 ${
            copied
              ? 'border-orange text-orange'
              : 'border-navy-border text-white/50 hover:text-white hover:border-white/30'
          }`}
        >
          {copied ? 'copied!' : 'copy code'}
        </button>
      </div>
      <div className={`p-6 flex items-center justify-center min-h-[140px] ${bgClass}`}>
        {pattern.preview}
      </div>
      <pre className="font-mono text-[11px] leading-relaxed p-4 text-white/65 whitespace-pre-wrap break-all m-0 bg-[#0a0c10] border-t border-navy-border max-h-[180px] overflow-y-auto">
        {pattern.code}
      </pre>
    </div>
  )
}

export function PatternGallery() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {PATTERNS.map((p) => (
        <PatternCard key={p.name} pattern={p} />
      ))}
    </div>
  )
}
