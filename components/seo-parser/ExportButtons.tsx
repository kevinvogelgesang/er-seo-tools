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
  const [loading, setLoading] = useState<Format | 'claude' | null>(null);
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

  const handleClaudeExport = async () => {
    setLoading('claude');
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}/claude`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `technical-audit-claude-${sessionId.slice(0, 8)}.json`;
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
        {(['json', 'summary', 'markdown'] as Format[]).map((format) => {
          const labels: Record<Format, string> = {
            json: 'Export JSON',
            summary: 'Export Summary',
            markdown: 'Export Markdown',
          };
          const colors: Record<Format, string> = {
            json: 'bg-[#1c2d4a] hover:bg-[#0f1d30]',
            summary: 'bg-gray-600 hover:bg-gray-700',
            markdown: 'bg-green-700 hover:bg-green-800',
          };
          return (
            <button
              key={format}
              onClick={() => void handleExport(format)}
              disabled={loading !== null}
              className={`px-4 py-2 ${colors[format]} text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5`}
            >
              {loading === format && <Spinner />}
              {labels[format]}
            </button>
          );
        })}
        <button
          onClick={() => void handleClaudeExport()}
          disabled={loading !== null}
          className="px-4 py-2 bg-[#c07f2a] hover:bg-[#a86e22] text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {loading === 'claude' && <Spinner />}
          Export Technical Audit for Claude
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
