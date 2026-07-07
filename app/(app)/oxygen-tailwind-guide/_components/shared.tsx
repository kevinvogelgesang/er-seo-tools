'use client'

import { useRef, useState } from 'react'

export function Callout({
  type,
  icon,
  children,
}: {
  type: 'warn' | 'info' | 'success' | 'danger' | 'tip'
  icon: string
  children: React.ReactNode
}) {
  const styles: Record<string, string> = {
    warn: 'border-l-4 border-amber-500 bg-amber-500/10 text-amber-200',
    info: 'border-l-4 border-blue-500 bg-blue-500/10 text-blue-200',
    success: 'border-l-4 border-orange bg-orange/10 text-orange/90',
    danger: 'border-l-4 border-red-500 bg-red-500/10 text-red-200',
    tip: 'border-l-4 border-purple-500 bg-purple-500/10 text-purple-200',
  }
  return (
    <div
      className={`flex gap-3 items-start rounded-r-lg px-4 py-3 mt-3 text-[12px] leading-relaxed font-mono ${styles[type]}`}
    >
      <span className="text-[14px] flex-shrink-0 mt-0.5">{icon}</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}

export function StepNum({
  n,
  variant = 'green',
}: {
  n: string | number
  variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger'
}) {
  const bg: Record<string, string> = {
    green: 'bg-orange text-navy-deep',
    blue: 'bg-blue-500 text-white',
    warn: 'bg-amber-400 text-navy-deep',
    purple: 'bg-purple-500 text-white',
    danger: 'bg-red-500 text-white',
  }
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold ${bg[variant]}`}
    >
      {n}
    </div>
  )
}

export function SectionHeader({
  step,
  variant,
  title,
  phase,
  id,
}: {
  step: string | number
  variant?: 'green' | 'blue' | 'warn' | 'purple' | 'danger'
  title: string
  phase?: string
  id?: string
}) {
  return (
    <div id={id} className="flex items-center gap-3 mb-4 scroll-mt-24">
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

export function PhaseBanner({ text, id }: { text: string; id?: string }) {
  return (
    <div
      id={id}
      className="font-mono text-[10px] tracking-[0.15em] uppercase text-white/40 pt-1.5 pb-4 border-t border-navy-border mb-6 scroll-mt-24"
    >
      {text}
    </div>
  )
}

export function Divider() {
  return (
    <div className="relative h-px bg-navy-border my-10">
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-navy text-navy-border font-mono text-[11px] px-3">
        //
      </span>
    </div>
  )
}

export function CodeBlock({
  label,
  children,
  language,
}: {
  label: string
  children: React.ReactNode
  language?: string
}) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const handleCopy = () => {
    const text = preRef.current?.innerText ?? ''
    navigator.clipboard.writeText(text.trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <div className="rounded-lg bg-[#0a0c10] border border-navy-border mt-3 overflow-hidden">
      <div className="flex justify-between items-center px-4 py-2 border-b border-navy-border bg-[#0f1118]">
        <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">
          {label}{language ? <span className="text-white/30 ml-2">· {language}</span> : null}
        </span>
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
        ref={preRef}
        className="font-mono text-[12px] leading-relaxed p-4 text-white/70 whitespace-pre-wrap break-all m-0"
      >
        {children}
      </pre>
    </div>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-navy-card border border-navy-border rounded-xl p-5 ${className}`}>
      {children}
    </div>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[13px] text-white/70 font-body leading-relaxed">{children}</p>
}

export function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-white text-[12px] mb-1 mt-3.5 font-body font-semibold">{children}</p>
}

export function Pill({ children, color = 'orange' }: { children: React.ReactNode; color?: 'orange' | 'blue' | 'purple' }) {
  const styles: Record<string, string> = {
    orange: 'bg-orange/15 text-orange border-orange/30',
    blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  }
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] tracking-wide uppercase border rounded px-2 py-0.5 ${styles[color]}`}
    >
      {children}
    </span>
  )
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[12px] text-orange bg-orange/10 px-1.5 py-0.5 rounded border border-orange/20">
      {children}
    </code>
  )
}

export function KeyTable({ rows }: { rows: { class: string; effect: string }[] }) {
  return (
    <div className="rounded-lg border border-navy-border overflow-hidden mt-3">
      <table className="w-full border-collapse font-mono text-[12px]">
        <thead>
          <tr className="bg-[#0f1118]">
            <th className="text-left text-white/40 font-normal tracking-widest uppercase text-[10px] px-3 py-2 border-b border-navy-border w-[35%]">
              Class
            </th>
            <th className="text-left text-white/40 font-normal tracking-widest uppercase text-[10px] px-3 py-2 border-b border-navy-border">
              Effect
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-navy-card/40' : ''}>
              <td className="px-3 py-1.5 border-b border-navy-border/50 text-orange">{r.class}</td>
              <td className="px-3 py-1.5 border-b border-navy-border/50 text-white/60">{r.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
