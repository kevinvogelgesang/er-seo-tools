'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface HistoryItem {
  id: string;
  createdAt: string;
  status: string;
  files: string[];
}

export function HistoryList() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/parse/history')
      .then((r) => r.json())
      .then((data) => {
        setHistory(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <div className="text-center py-4 text-gray-400 text-sm">Loading history…</div>;
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
            <div className="flex justify-between items-start mb-2">
              <span className="text-sm text-gray-500">{new Date(item.createdAt).toLocaleString()}</span>
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
            <div className="text-sm font-medium text-gray-700 truncate">{item.files.join(', ')}</div>
            <div className="mt-3 text-[#f5a623] text-xs font-semibold group-hover:underline">View Results →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
