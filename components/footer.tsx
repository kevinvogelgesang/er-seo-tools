'use client'

import Link from 'next/link'
import packageJson from '@/package.json'

const toolLinks = [
  { name: 'SEO Parser', href: '/seo-parser' },
  { name: 'ADA Audit', href: '/ada-audit' },
  { name: 'Robots Validator', href: '/robots-validator' },
  { name: 'Quarter Grid', href: '/quarter-grid' },
  { name: 'RankMath Redirects', href: '/rankmath-redirects' },
  { name: 'Clients', href: '/clients' },
]

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-navy-deep text-white border-t border-navy-border/40">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">

          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 bg-orange rounded flex items-center justify-center flex-shrink-0">
                <span className="font-display font-extrabold text-navy text-[11px] leading-none">ER</span>
              </div>
              <span className="font-bold text-[15px]">
                <span className="font-display">SEO Tools</span>
              </span>
            </div>
            <p className="text-white/50 text-sm font-body leading-relaxed max-w-[220px]">
              Purpose-built SEO tools for enrollment marketers and web teams at Enrollment Resources.
            </p>
          </div>

          {/* Tools */}
          <div>
            <h3 className="font-display font-semibold text-[13px] text-white/60 uppercase tracking-widest mb-4">
              Tools
            </h3>
            <ul className="space-y-2.5">
              {toolLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[14px] font-body text-white/60 hover:text-orange transition-colors duration-150"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* About */}
          <div>
            <h3 className="font-display font-semibold text-[13px] text-white/60 uppercase tracking-widest mb-4">
              About
            </h3>
            <p className="text-[14px] font-body text-white/60 leading-relaxed max-w-[240px]">
              An internal toolkit for the Enrollment Resources SEO and web teams —
              accessibility audits, technical SEO, and client reporting in one place.
            </p>
          </div>

        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[13px] font-body text-white/55">
            &copy; {year} Enrollment Resources. Internal tool — not for external distribution.
          </p>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[12px] font-body text-white/55">er-seo-tools v{packageJson.version}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
