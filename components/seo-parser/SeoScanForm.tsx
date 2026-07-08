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
  const [progress, setProgress] = useState<number | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: a ?scan=<id> handoff (from SiteAuditForm / QuickSiteAuditWidget)
  // WINS over a stale sessionStorage id; otherwise resume a stored pending scan.
  // Read in an effect (never during render) — no hydration mismatch, no
  // useSearchParams (this page has no Suspense boundary).
  useEffect(() => {
    let id: string | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get('scan');
      if (q) {
        id = q;
        try {
          sessionStorage.setItem(STORAGE_KEY, q);
        } catch {
          // ignore
        }
        try {
          // Strip ?scan= so a later refresh doesn't re-adopt this stale id
          // and clobber sessionStorage if the operator has since started a
          // new scan.
          window.history.replaceState({}, '', '/seo-parser');
        } catch {
          // ignore
        }
      } else {
        id = sessionStorage.getItem(STORAGE_KEY);
      }
    } catch {
      // sessionStorage/location unavailable — degrade silently.
    }
    if (id) {
      setAuditId(id);
      setRunId(null);
      setError(null);
      setProgress(null);
      setProgressMsg(null);
      setPhase('running');
    }
  }, []);

  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/site-audit/${id}`);
    const clearProgress = () => {
      setProgress(null);
      setProgressMsg(null);
    };
    if (!res.ok) {
      if (res.status === 404) {
        setError('SEO scan failed — the scan could not be found.');
        setPhase('error');
        clearProgress();
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      }
      return; // other non-OK → transient, keep polling
    }
    const d = await res.json();
    if (d.status === 'error' || d.status === 'cancelled') {
      setError('SEO scan failed — please try again.');
      setPhase('error');
      clearProgress();
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }
    if (d.status === 'complete') {
      const st = d.seoPhase?.state;
      if (d.liveScanRunId) {
        setRunId(d.liveScanRunId);
        setPhase('ready');
        clearProgress();
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      } else if (st === 'failed') {
        setError('SEO analysis failed — please try again.');
        setPhase('error');
        clearProgress();
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      } else if (st === 'unavailable') {
        setError('SEO analysis is unavailable for this scan.');
        setPhase('error');
        clearProgress();
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      } else {
        // running | queued — verifier in flight
        setProgress(d.seoPhase?.progress ?? null);
        setProgressMsg(d.seoPhase?.message ?? null);
        setPhase('building');
      }
      return;
    }
    setPhase('running');
    clearProgress();
  }, []);

  useEffect(() => {
    if (!auditId || phase === 'ready' || phase === 'error') return;
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
      setProgress(null);
      setProgressMsg(null);
      try {
        sessionStorage.setItem(STORAGE_KEY, d.id);
      } catch {
        // ignore
      }
      return;
    }
    if (res.status === 409 && d.id) {
      setAuditId(d.id);
      setRunId(null);
      setPhase('running');
      setProgress(null);
      setProgressMsg(null);
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
        <div className="mt-3">
          <StatusPill tone="running" label="Building SEO report…" />
          {progressMsg && (
            <p className="mt-2 text-[12px] text-navy/50 dark:text-white/50">{progressMsg}</p>
          )}
          {progress != null && (
            <div className="mt-2 h-2 w-full rounded-full bg-gray-100 dark:bg-navy-deep overflow-hidden">
              <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
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
