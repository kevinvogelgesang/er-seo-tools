import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Quarter Grid',
  description: 'Drag-and-drop SEO quarterly planning across clients.',
}

const versions = [
  {
    id: 'v1',
    href: '/quarter-grid/v1',
    label: 'Version 1',
    desc: 'Original quarterly planning grid.',
  },
  {
    id: 'v2',
    href: '/quarter-grid/v2',
    label: 'Version 2',
    desc: 'Updated layout with improved drag-and-drop.',
  },
  {
    id: 'v3',
    href: '/quarter-grid/v3',
    label: 'Version 3',
    desc: 'Latest version with priority tiers, snapshots, and JSON export.',
  },
]

export default function QuarterGridIndexPage() {
  return (
    <section className="min-h-[60vh] bg-navy grid-lines py-24 px-6">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[13px] font-body mb-10 transition-colors"
        >
          ← All Tools
        </Link>

        <p className="text-[11px] font-body font-semibold text-orange/70 uppercase tracking-[0.2em] mb-3">
          Quarter Grid
        </p>
        <h1 className="font-display font-extrabold text-4xl text-white mb-4">
          Choose a Version
        </h1>
        <p className="font-body text-white/45 text-[15px] leading-relaxed mb-12">
          All three versions of the SEO Quarter Grid are available. Start with the latest (V3) or use a previous version if your workflow prefers it.
        </p>

        <div className="flex flex-col gap-4">
          {versions.map((v, i) => (
            <Link
              key={v.id}
              href={v.href}
              className="group flex items-center justify-between bg-navy-card border border-navy-border hover:border-orange/50 rounded-xl px-6 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0 group-hover:bg-orange/25 transition-colors">
                  <span className="font-display font-extrabold text-orange text-[15px]">
                    V{i + 1}
                  </span>
                </div>
                <div>
                  <div className="font-display font-bold text-white text-[15px] mb-0.5">
                    {v.label}
                    {i === 2 && (
                      <span className="ml-2 text-[10px] bg-orange/20 text-orange px-2 py-0.5 rounded-full font-body font-semibold">
                        Latest
                      </span>
                    )}
                  </div>
                  <div className="font-body text-[13px] text-white/45">{v.desc}</div>
                </div>
              </div>
              <svg
                className="w-4 h-4 text-orange/40 group-hover:text-orange group-hover:translate-x-1 transition-all duration-200 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
