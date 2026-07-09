// C18: collapsed-by-default so the limitations note is softer/less prominent.
// A native <details> keeps it SSR-safe (no post-mount state → no hydration risk).
export function KnownLimitationsNotice({ variant = 'single' }: { variant?: 'single' | 'site' }) {
  return (
    <details className="group px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <summary className="flex items-center gap-2 cursor-pointer list-none font-semibold">
        <svg className="w-4 h-4 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Known limitations
        <span className="ml-auto text-amber-500 transition-transform group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <div className="mt-2 pl-6">
        {variant === 'site' ? (
          <>
            Content behind login walls, scroll-triggered lazy loads,
            and interactive states (open modals, expanded accordions) may not be captured.
            Hover, focus, and other interactive states are not evaluated — CSS applied only via <code>:hover</code> or <code>:focus</code> pseudo-classes (e.g., underlines that appear on hover) are not visible to the scanner. WCAG requires links to be distinguishable without relying on interaction.
            Treat results as a starting point.
          </>
        ) : (
          <>
            This audit runs in a real browser and renders JavaScript,
            CSS, and fonts. However, content behind login walls, scroll-triggered lazy loads,
            and interactive states (open modals, expanded accordions) may not be captured.
            Treat results as a starting point, not a certification.
          </>
        )}
      </div>
    </details>
  );
}
