'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const PRESETS: { name: string; html: string }[] = [
  {
    name: 'Button',
    html: `<button class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
  Save changes
</button>`,
  },
  {
    name: 'Card',
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
    name: 'Nav',
    html: `<header class="border-b border-slate-200 bg-white/80 backdrop-blur">
  <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
    <a href="#" class="text-lg font-bold text-slate-900">Acme</a>
    <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700">
      <a href="#" class="hover:text-slate-900">Features</a>
      <a href="#" class="hover:text-slate-900">Pricing</a>
      <a href="#" class="hover:text-slate-900">About</a>
    </nav>
    <button class="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Sign in</button>
  </div>
</header>`,
  },
  {
    name: 'Form',
    html: `<form class="max-w-sm space-y-4 rounded-xl bg-white p-6 shadow ring-1 ring-slate-900/5">
  <label class="block">
    <span class="block text-sm font-medium text-slate-700">Email</span>
    <input type="email" placeholder="you@example.com" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
  </label>
  <label class="block">
    <span class="block text-sm font-medium text-slate-700">Password</span>
    <input type="password" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
  </label>
  <button class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
    Sign in
  </button>
</form>`,
  },
  {
    name: 'Grid',
    html: `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-2xl">
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">1</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">2</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">3</div>
  <div class="rounded-lg bg-blue-200 p-4 text-center text-blue-900 font-medium col-span-2">4–5</div>
  <div class="rounded-lg bg-blue-100 p-4 text-center text-blue-800 font-medium">6</div>
</div>`,
  },
]

function buildSrcDoc(html: string, bg: 'light' | 'dark') {
  const bgClass = bg === 'dark' ? 'bg-slate-900' : 'bg-slate-50'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 24px; }
</style>
</head>
<body class="${bgClass} font-sans antialiased flex items-center justify-center">
  <div>
${html}
  </div>
</body>
</html>`
}

export function Playground() {
  const [code, setCode] = useState<string>(PRESETS[0].html)
  const [debounced, setDebounced] = useState<string>(code)
  const [bg, setBg] = useState<'light' | 'dark'>('light')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(code), 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [code])

  const srcDoc = useMemo(() => buildSrcDoc(debounced, bg), [debounced, bg])

  return (
    <div className="bg-navy-card border border-navy-border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-navy-border bg-[#0f1118]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase mr-2">
            Presets:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setCode(p.html)}
              className="font-mono text-[10px] tracking-wide uppercase border border-navy-border bg-transparent text-white/55 hover:text-white hover:border-orange/50 rounded px-2 py-0.5 transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase mr-1">
            BG:
          </span>
          <button
            onClick={() => setBg('light')}
            className={`font-mono text-[10px] uppercase border rounded px-2 py-0.5 ${
              bg === 'light'
                ? 'border-orange text-orange'
                : 'border-navy-border text-white/40 hover:text-white/60'
            }`}
          >
            Light
          </button>
          <button
            onClick={() => setBg('dark')}
            className={`font-mono text-[10px] uppercase border rounded px-2 py-0.5 ${
              bg === 'dark'
                ? 'border-orange text-orange'
                : 'border-navy-border text-white/40 hover:text-white/60'
            }`}
          >
            Dark
          </button>
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
        Edits debounced 350ms · sandboxed iframe · runs Tailwind v3 in the browser via{' '}
        <code className="text-orange">cdn.tailwindcss.com</code>
      </div>
    </div>
  )
}
