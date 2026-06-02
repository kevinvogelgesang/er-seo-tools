'use client';

import { useState } from 'react';
import { Spinner } from '@/components/Spinner';

interface ExportButtonsProps {
  sessionId: string;
}

type Format = 'json' | 'summary' | 'markdown';

const EXTENSIONS: Record<Format, string> = {
  json: 'json',
  summary: 'txt',
  markdown: 'md',
};

export function ExportButtons({ sessionId }: ExportButtonsProps) {
  const [loading, setLoading] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: Format) => {
    setLoading(format);
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}/${format}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-report-${sessionId.slice(0, 8)}.${EXTENSIONS[format]}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <details className="relative">
          <summary className="list-none px-4 py-2 bg-gray-200 dark:bg-navy-light text-gray-700 dark:text-white/70 rounded-lg text-sm font-medium cursor-pointer">
            {loading !== null ? <span className="flex items-center gap-1.5"><Spinner />Exporting…</span> : 'Export ▾'}
          </summary>
          <div className="absolute z-10 mt-1 bg-white dark:bg-navy-card border border-gray-100 dark:border-navy-border rounded-lg shadow-sm p-1 min-w-[12rem]">
            {(['json', 'summary', 'markdown'] as Format[]).map((f) => (
              <button
                key={f}
                onClick={() => void handleExport(f)}
                disabled={loading !== null}
                className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-gray-50 dark:hover:bg-navy-light disabled:opacity-60"
              >
                {{ json: 'Raw JSON', summary: 'Summary (.txt)', markdown: 'Markdown' }[f]}
              </button>
            ))}
          </div>
        </details>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
