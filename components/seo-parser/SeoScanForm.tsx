'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusPill } from '@/components/ui/StatusPill';

type Phase = 'idle' | 'submitting' | 'running' | 'building' | 'ready' | 'error';

const STORAGE_KEY = 'seo-scan-id';

export function SeoScanForm() {
  const [domain, setDomain] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [auditId, setAuditId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Survive a soft refresh: resume polling a still-pending scan.
  // sessionStorage read happens on mount (effect), never during render, to avoid hydration mismatch.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        setAuditId(saved);
        setPhase('running');
      }
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — degrade silently.
    }
  }, []);

  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/site-audit/${id}`);
    if (!res.ok) return;
    const d = await res.json();
    if (d.status === 'complete' && d.liveScanRunId) {
      setRunId(d.liveScanRunId);
      setPhase('ready');
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    } else if (d.status === 'complete') {
      setPhase('building');
    } else {
      setPhase('running');
    }
  }, []);

  useEffect(() => {
    if (!auditId || phase === 'ready') return;
    void poll(auditId); // immediate first poll (snappy + test-friendly)
    timer.current = setInterval(() => {
      void poll(auditId);
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auditId, phase, poll]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = domain.trim();
    if (!value) return;
    setPhase('submitting');
    setError(null);
    const res = await fetch('/api/site-audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: value, seoOnly: true }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 202 && d.id) {
      setAuditId(d.id);
      setPhase('running');
      try {
        sessionStorage.setItem(STORAGE_KEY, d.id);
      } catch {
        // ignore
      }
      return;
    }
    if (res.status === 409) {
      setError(d.error || 'A scan for this domain is already running.');
      setPhase('error');
      return;
    }
    setError(d.error || 'Could not start the scan.');
    setPhase('error');
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 mb-6">
      <h2 className="font-semibold text-navy dark:text-white text-sm mb-4 uppercase tracking-wide">
        Scan a URL for SEO
      </h2>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-sm text-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/40"
        />
        <button
          type="submit"
          disabled={phase === 'submitting' || !domain.trim()}
          className="bg-orange text-navy font-display font-bold text-sm px-6 py-2 rounded-lg hover:bg-orange-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {phase === 'submitting' ? 'Starting…' : 'Scan'}
        </button>
      </form>

      {phase === 'running' && (
        <p className="mt-3">
          <StatusPill tone="running" label="SEO scan running…" />
        </p>
      )}
      {phase === 'building' && (
        <p className="mt-3">
          <StatusPill tone="running" label="Building SEO report…" />
        </p>
      )}
      {phase === 'ready' && runId && (
        <p className="mt-3 text-sm">
          <a
            href={`/seo-parser/results/run/${runId}`}
            className="font-bold text-orange hover:underline dark:text-orange"
          >
            View SEO results →
          </a>
        </p>
      )}
      {error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
