'use client'
// C14 redesign: sticky branded header. Shrinks smoothly past ~80px of scroll
// (CSS transitions on a `scrolled` state class; passive listener, removed on
// unmount). Book a review smooth-scrolls to #inquiry — behavior chosen via
// matchMedia('(prefers-reduced-motion: reduce)') (spec Codex fix 7, not a
// CSS-only guess). Print: static + unshrunk (print: variants).
import { useEffect, useState } from 'react'

const SCROLL_THRESHOLD_PX = 80

export function SalesReportHeader(props: {
  prospectName: string
  domain: string
  preparedBy: string | null
}) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const bookReview = () => {
    const target = document.getElementById('inquiry')
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <header
      className={`sticky top-0 z-40 print:static bg-white/95 dark:bg-navy-card/95 backdrop-blur border-b border-gray-200 dark:border-navy-border transition-all duration-300 ${
        scrolled ? 'py-2' : 'py-4'
      } print:py-4`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {/* Real asset is a WHITE-on-transparent PNG (ER's site is dark-themed
              and only publishes white logos). brightness-0 = black silhouette
              on the white light-mode header; dark:brightness-100 = unchanged
              (white) on the navy dark-mode header. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/er-logo.png"
            alt="Enrollment Resources"
            className={`w-auto shrink-0 transition-all duration-300 brightness-0 dark:brightness-100 print:h-10 ${
              scrolled ? 'h-6 sm:h-7' : 'h-8 sm:h-10'
            }`}
          />
          <div className="min-w-0">
            <p
              className={`font-heading font-bold text-navy dark:text-white leading-tight transition-all duration-300 ${
                scrolled ? 'text-sm' : 'text-base sm:text-lg'
              } print:text-lg`}
            >
              Website Audit Report
            </p>
            {/* Full provenance on sm+; just the domain on phones so the header
                row stays one clean line next to the button. */}
            <p className="text-[11px] sm:text-[12px] font-body text-navy/50 dark:text-white/50 truncate">
              <span className="sm:hidden">{props.domain}</span>
              <span className="hidden sm:inline">
                Prepared for {props.prospectName} · {props.domain} ·{' '}
                {props.preparedBy ? `By ${props.preparedBy} @ Enrollment Resources` : 'By Enrollment Resources'}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={bookReview}
          className="shrink-0 whitespace-nowrap rounded-full bg-blue-700 hover:bg-blue-800 text-white font-heading font-semibold text-[12px] sm:text-[13px] px-3 sm:px-4 py-2 print:hidden"
        >
          Book a review
        </button>
      </div>
    </header>
  )
}
