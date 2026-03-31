export function KnownLimitationsNotice({ variant = 'single' }: { variant?: 'single' | 'site' }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        {variant === 'site' ? (
          <>
            <strong>Known limitations:</strong> Pages are audited from static HTML only. External stylesheets,
            client-rendered content, and lazy-loaded sections are not included. Treat results as a starting point.
          </>
        ) : (
          <>
            <strong>Known limitations:</strong> This audit analyzes the static HTML snapshot only.
            External stylesheets are not loaded, so color-contrast results may not reflect the
            rendered page. Client-rendered content (React/Angular SPAs), lazy-loaded sections,
            and content inside modals will not be included. Treat results as a starting point,
            not a certification.
          </>
        )}
      </span>
    </div>
  );
}
