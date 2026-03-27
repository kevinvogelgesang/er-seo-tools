'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface HistoryItem {
  id: string;
  createdAt: string;
  status: string;
  files: string[];
  siteName?: string | null;
  healthScore?: number;
}

function HealthDot({ score }: { score: number }) {
  const color =
    score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-orange-400' : 'bg-red-500';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        score >= 70
          ? 'bg-green-100 text-green-700'
          : score >= 40
          ? 'bg-orange-100 text-orange-700'
          : 'bg-red-100 text-red-700'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {score}
    </span>
  );
}

export function HistoryList() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/parse/history', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setHistory(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setFetchError(true);
          setIsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (isLoading) {
    return <div className="text-center py-4 text-gray-400 text-sm">Loading history…</div>;
  }

  if (fetchError) {
    return <div className="text-center py-4 text-red-400 text-sm">Failed to load history.</div>;
  }

  if (history.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-xl font-bold text-[#1c2d4a] mb-4">Recent Analyses</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {history.map((item) => (
          <button
            key={item.id}
            onClick={() => router.push(`/seo-parser/results/${item.id}`)}
            className="text-left p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow group"
          >
            <div className="flex justify-between items-start mb-1">
              <span className="text-sm font-semibold text-gray-800 truncate">
                {item.siteName || item.files[0] || 'Unnamed session'}
              </span>
              <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                {item.status === 'complete' && item.healthScore !== undefined && (
                  <HealthDot score={item.healthScore} />
                )}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === 'complete'
                      ? 'bg-green-100 text-green-700'
                      : item.status === 'error'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-400 mb-2">
              {new Date(item.createdAt).toLocaleString()} · {item.files.length} file{item.files.length !== 1 ? 's' : ''}
            </div>
            <div className="mt-2 text-[#f5a623] text-xs font-semibold group-hover:underline">
              View Results →
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
