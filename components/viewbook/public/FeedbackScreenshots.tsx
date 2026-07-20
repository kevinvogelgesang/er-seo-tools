'use client'

// Collapsed-by-default screenshot expander for a sent feedback item, shared by
// the public FeedbackThread (light-only brand canvas) and the admin
// FeedbackTab (dark-mode aware — pass `admin`). Clicking a thumbnail opens the
// full image in a new tab.

export function FeedbackScreenshots({
  filenames,
  hrefFor,
  admin = false,
}: {
  filenames: string[]
  hrefFor: (filename: string) => string
  admin?: boolean
}) {
  if (filenames.length === 0) return null
  const summaryClass = admin
    ? 'cursor-pointer text-xs font-semibold text-gray-600 hover:text-navy dark:text-white/60 dark:hover:text-white'
    : 'cursor-pointer text-xs font-semibold opacity-70 hover:opacity-100'
  const frameClass = admin
    ? 'block overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-navy-border dark:bg-navy-deep/40'
    : 'block overflow-hidden rounded-lg border border-current/15 bg-black/5'
  return (
    <details className="mt-2">
      <summary className={summaryClass}>
        Screenshots ({filenames.length})
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {filenames.map((filename) => (
          <a
            key={filename}
            href={hrefFor(filename)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open screenshot in a new tab"
            className={frameClass}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hrefFor(filename)}
              alt="Feedback screenshot"
              loading="lazy"
              className="h-28 w-full object-cover"
            />
          </a>
        ))}
      </div>
    </details>
  )
}
