import type { FileReport, FileReportStatus } from '@/lib/types';

interface FileProcessingPanelProps {
  reports: FileReport[] | undefined;
  archived?: boolean;
  legacy: { filesProcessed: number; parsersUsed: number; totalParsers?: number };
}

const STATUS_LABEL: Record<FileReportStatus, string> = {
  parsed: 'Parsed',
  failed: 'Failed',
  unmatched: 'Not recognized',
  skipped: 'Skipped',
};

const STATUS_BADGE: Record<FileReportStatus, string> = {
  parsed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  unmatched: 'bg-gray-100 text-gray-600 dark:bg-navy-light dark:text-white/60',
  skipped: 'bg-gray-100 text-gray-600 dark:bg-navy-light dark:text-white/60',
};

export function FileProcessingPanel({ reports, archived, legacy }: FileProcessingPanelProps) {
  if (archived) return null;

  if (!reports || reports.length === 0) {
    return (
      <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
        {legacy.filesProcessed} files · {legacy.parsersUsed}
        {legacy.totalParsers ? `/${legacy.totalParsers}` : ''} parsers matched
      </p>
    );
  }

  const parsed = reports.filter((r) => r.status === 'parsed').length;
  const failed = reports.filter((r) => r.status === 'failed').length;
  const notRecognized = reports.filter((r) => r.status === 'unmatched' || r.status === 'skipped').length;
  const coreFailures = reports.filter((r) => r.status === 'failed' && r.severity === 'core');

  const summaryParts = [
    parsed ? `${parsed} parsed` : null,
    failed ? `${failed} failed` : null,
    notRecognized ? `${notRecognized} not recognized` : null,
  ].filter(Boolean);

  // Non-parsed first (failed → unmatched → skipped), then parsed.
  const order: Record<FileReportStatus, number> = { failed: 0, unmatched: 1, skipped: 2, parsed: 3 };
  const sorted = [...reports].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="mt-2 text-sm">
      {coreFailures.length > 0 && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          Core export{coreFailures.length > 1 ? 's' : ''}{' '}
          {coreFailures.map((r) => r.filename).join(', ')} failed to parse — the health score may be unreliable.
        </div>
      )}

      <details className="text-gray-500 dark:text-white/50">
        <summary className="cursor-pointer select-none hover:text-gray-700 dark:hover:text-white/70">
          File processing: {summaryParts.join(' · ')}
        </summary>
        <ul className="mt-2 space-y-1">
          {sorted.map((r) => (
            <li key={r.filename} className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
              <span className="text-gray-700 dark:text-white/70 break-all">
                {r.filename}
                {r.status === 'parsed' && r.parser ? ` — ${r.parser}` : ''}
                {r.status === 'failed' && r.error ? ` — ${r.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
