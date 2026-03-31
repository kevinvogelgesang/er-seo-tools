export function KnownLimitationsNotice({ variant = 'single' }: { variant?: 'single' | 'site' }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        {variant === 'site' ? (
          <>
            <strong>Known limitations:</strong> Content behind login walls, scroll-triggered lazy loads,
            and interactive states (open modals, expanded accordions) may not be captured.
            Treat results as a starting point.
          </>
        ) : (
          <>
            <strong>Known limitations:</strong> This audit runs in a real browser and renders JavaScript,
            CSS, and fonts. However, content behind login walls, scroll-triggered lazy loads,
            and interactive states (open modals, expanded accordions) may not be captured.
            Treat results as a starting point, not a certification.
          </>
        )}
      </span>
    </div>
  );
}
