'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { useRouter } from 'next/navigation';

interface HistoryItem {
  id: string;
  createdAt: string;
  status: string;
  files: string[];
  siteName?: string | null;
  clientId?: number | null;
  clientName?: string | null;
  healthScore?: number;
  urlCount?: number;
}

interface ClientOption {
  id: number;
  name: string;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
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

function SkeletonCard() {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm animate-pulse">
      <div className="flex justify-between items-start mb-2">
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-4 bg-gray-200 rounded w-12 ml-2" />
      </div>
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-16" />
    </div>
  );
}

export function HistoryList() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<number | 'unassigned' | ''>('');
  const router = useRouter();

  const loadHistory = () => {
    setIsLoading(true);
    setFetchError(false);
    const controller = new AbortController();

    Promise.all([
      fetch('/api/parse/history', { signal: controller.signal }).then((r) => r.json()),
      fetch('/api/clients', { signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([historyData, clientsData]) => {
        setHistory(Array.isArray(historyData) ? historyData : []);
        setClients(Array.isArray(clientsData) ? clientsData : []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setFetchError(true);
          setIsLoading(false);
        }
      });

    return controller;
  };

  useEffect(() => {
    const controller = loadHistory();
    return () => controller.abort();
  }, []);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/parse/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-12">
        <div className="h-7 bg-gray-200 rounded w-40 mb-4 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="mt-12 text-center py-6">
        <p className="text-red-400 text-sm mb-3">Failed to load history.</p>
        <button
          onClick={() => loadHistory()}
          className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="mt-12 text-center py-8 text-gray-400">
        <p className="text-sm mb-1">No analyses yet.</p>
        <p className="text-xs">Upload files above to get started.</p>
      </div>
    );
  }

  const filtered = history.filter((item) => {
    if (search.trim()) {
      const name = (item.siteName || item.files[0] || '').toLowerCase();
      if (!name.includes(search.trim().toLowerCase())) return false;
    }
    if (clientFilter === 'unassigned') return !item.clientId;
    if (typeof clientFilter === 'number') return item.clientId === clientFilter;
    return true;
  });

  return (
    <div className="mt-12">
      <h2 className="text-xl font-bold text-[#1c2d4a] mb-4">Recent Analyses</h2>

      {/* Filters row */}
      <div className="flex gap-2 mb-4">
        {/* Search input */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Filter by site name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f5a623]/40 bg-white"
          />
        </div>

        {/* Client filter dropdown */}
        {clients.length > 0 && (
          <select
            value={clientFilter === '' ? '' : clientFilter === 'unassigned' ? 'unassigned' : String(clientFilter)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') setClientFilter('');
              else if (v === 'unassigned') setClientFilter('unassigned');
              else setClientFilter(parseInt(v, 10));
            }}
            className="py-2 pl-3 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f5a623]/40 bg-white text-gray-600 min-w-[140px]"
          >
            <option value="">All clients</option>
            <option value="unassigned">Unassigned</option>
            {clients.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No results match your filters.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((item) => (
            <div key={item.id} className="relative group">
              <button
                onClick={() => router.push(`/seo-parser/results/${item.id}`)}
                className="text-left w-full p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-1 pr-6">
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
                {item.clientName && (
                  <div className="mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#1c2d4a]/8 text-[#1c2d4a] font-medium">
                      {item.clientName}
                    </span>
                  </div>
                )}
                <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                  <span>{relativeTime(item.createdAt)}</span>
                  <span>&middot;</span>
                  <span>
                    {item.files.length} file{item.files.length !== 1 ? 's' : ''}
                  </span>
                  {item.urlCount !== undefined && (
                    <>
                      <span>&middot;</span>
                      <span>{item.urlCount.toLocaleString()} URLs</span>
                    </>
                  )}
                </div>
                <div className="mt-2 text-[#f5a623] text-xs font-semibold group-hover:underline">
                  View Results →
                </div>
              </button>

              {/* Delete button — visible on hover */}
              {confirmDelete === item.id ? (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-sm px-2 py-1 z-10">
                  <span className="text-xs text-gray-600 mr-1">Delete?</span>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-600 font-semibold hover:text-red-800 px-1"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 px-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(item.id);
                  }}
                  disabled={deletingId === item.id}
                  aria-label="Delete session"
                  className="absolute top-2 right-2 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                >
                  {deletingId === item.id ? (
                    <Spinner />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
