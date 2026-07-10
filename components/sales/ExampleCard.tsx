import type { CuratedExample } from '@/lib/sales/representative-examples'

export function ExampleCard(props: { example: CuratedExample; token: string; alt: string }) {
  const { example } = props
  const src = example.screenshotFile && example.adaAuditId
    ? `/api/sales/${props.token}/screenshot/${example.adaAuditId}/${example.screenshotFile}`
    : null
  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-2">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={props.alt} className="max-w-full rounded-lg border border-gray-100 dark:border-navy-border" />
      )}
      <pre className="overflow-x-auto rounded-lg bg-gray-50 dark:bg-navy-deep p-3 text-[12px] font-mono text-navy/80 dark:text-white/80">
        {example.html}
      </pre>
      {example.pageUrl && (
        <p className="text-[12px] font-body text-navy/45 dark:text-white/45 break-all">Found on {example.pageUrl}</p>
      )}
    </div>
  )
}
