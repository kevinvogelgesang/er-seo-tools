'use client';

// components/clients/KeywordStrategyCard.tsx
//
// KS-5 §9 — client-dashboard card for the keyword-strategy handoff. Slots
// immediately after KeywordProfileCard on /clients/[id]. It:
//   • renders the latest posted-back memo (reusing KeywordMemoMarkdown), and
//   • mints a `kst_` token, composes the clipboard prompt, and polls the
//     cookie-gated GET route for the skill's memo write-back.
//
// The poller reuses the shared memo-poller-machine (3s interval, 15-min active
// lifetime, visibilitychange pause) exactly like KeywordMemoCard. Unlike that
// card (which router.refresh()es a server-rendered page), this one owns its
// memo in local state and updates it from the poll response on change — the
// dashboard page is a big server component, so a targeted local update is
// cheaper and keeps the change-detection self-contained.

import { useEffect, useRef, useState } from 'react';
import { createPollingMachine } from '@/lib/memo-poller-machine';
import { composeKeywordStrategyPayload } from '@/lib/keyword-strategy-prompt';
import { KeywordMemoMarkdown } from '@/components/keyword-research/KeywordMemoMarkdown';

const POLL_INTERVAL_MS = 3000;
const LIFETIME_MS = 15 * 60 * 1000;

export interface KeywordStrategySessionInit {
  id: string;
  status: string;
  tokenMintedAt: string | null;
  memoMarkdown: string | null;
  memoUpdatedAt: string | null;
}

interface Props {
  clientId: number;
  initialSession: KeywordStrategySessionInit | null;
  readiness: { gscMapped: boolean; hasLiveScan: boolean; hasLocale: boolean };
  archived: boolean;
}

type ButtonState = 'idle' | 'minting' | 'copied' | 'error';

// Hydration-safe "Updated <date>" line: renders nothing until mounted so the
// server + first-client render never disagree on the localized string.
function UpdatedAt({ value }: { value: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <span className="text-xs text-gray-500 dark:text-white/50">
      Updated {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
    </span>
  );
}

export function KeywordStrategyCard({ clientId, initialSession, readiness, archived }: Props) {
  const [state, setState] = useState<ButtonState>('idle');
  const [memoMarkdown, setMemoMarkdown] = useState<string | null>(initialSession?.memoMarkdown ?? null);
  const [memoUpdatedAt, setMemoUpdatedAt] = useState<string | null>(initialSession?.memoUpdatedAt ?? null);
  // True between a successful mint and the skill's write-back: the old memo
  // stays visible with a "waiting" affordance while the new one is generated.
  const [regenerating, setRegenerating] = useState(false);

  const webappUrl =
    process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  // Baseline (last-known memoUpdatedAt) and the freshest fetched session live in
  // refs so the machine's onChange closure (created once) reads current values.
  const baselineRef = useRef<string | null>(initialSession?.memoUpdatedAt ?? null);
  const latestSessionRef = useRef<KeywordStrategySessionInit | null>(initialSession);

  const machineRef = useRef<ReturnType<typeof createPollingMachine> | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPollingMachine({
      onChange: () => {
        const s = latestSessionRef.current;
        if (!s) return;
        setMemoMarkdown(s.memoMarkdown);
        setMemoUpdatedAt(s.memoUpdatedAt);
        baselineRef.current = s.memoUpdatedAt;
        setRegenerating(false);
      },
      lifetimeMs: LIFETIME_MS,
    });
  }
  const machine = machineRef.current;

  // Visibility pause/resume.
  useEffect(() => {
    const onVisibility = () => machine.setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [machine]);

  // Auto-start on mount only when a generation is already in flight, anchored to
  // mint time so a stale 'processing' row doesn't restart a fresh 15-min cycle.
  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (initialSession?.status === 'processing' && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      const mintedMs = initialSession.tokenMintedAt ? new Date(initialSession.tokenMintedAt).getTime() : null;
      if (mintedMs == null || Date.now() - mintedMs < LIFETIME_MS) {
        machine.start({ baseline: baselineRef.current, now: mintedMs ?? Date.now() });
      }
    }
  }, [initialSession, machine]);

  // Polling loop.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (machine.status() !== 'polling') return;
      try {
        const res = await fetch(`/api/clients/${clientId}/keyword-strategy`);
        if (!res.ok) return;
        const body = await res.json();
        const s = (body?.session ?? null) as KeywordStrategySessionInit | null;
        latestSessionRef.current = s;
        const latest: string | null = s?.memoUpdatedAt ?? null;
        machine.tick({ latestUpdatedAt: latest, now: Date.now() });
      } catch {
        // Network errors are silent — the next tick retries.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [clientId, machine]);

  const onGenerate = async () => {
    if (state === 'minting' || archived) return;
    setState('minting');
    try {
      const res = await fetch(`/api/clients/${clientId}/keyword-strategy/mint-token`, { method: 'POST' });
      if (!res.ok) {
        setState('error');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      const { token, strategyId } = (await res.json()) as { token: string; strategyId: string };
      const payload = composeKeywordStrategyPayload({ webappUrl, strategyId, token });
      try {
        await navigator.clipboard.writeText(payload);
        setState('copied');
        setTimeout(() => setState('idle'), 2000);
      } catch {
        window.prompt('Copy this prompt for the er-handoff-memo skill:', payload);
        setState('idle');
      }
      // Anchor the new poll cycle to the FRESH session row the mint just
      // created. That row has memoUpdatedAt null; starting from the OLD memo's
      // memoUpdatedAt would make the first tick's `null !== oldDate` read as a
      // change — wiping the displayed memo and killing the poll before the
      // skill writes anything. Baseline null means the cycle completes only
      // when a real write-back stamps a non-null memoUpdatedAt.
      baselineRef.current = null;
      machine.start({ baseline: null, now: Date.now() });
      setRegenerating(true);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const label =
    state === 'minting' ? 'Minting…'
      : state === 'copied' ? 'Copied!'
      : state === 'error' ? 'Mint failed — retry'
      : 'Generate strategy prompt';

  const hasMemo = memoMarkdown != null && memoMarkdown.length > 0;

  const hints: string[] = [];
  if (!readiness.gscMapped) hints.push('No GSC mapping — GSC signals will be absent');
  if (!readiness.hasLiveScan) hints.push('No live scan yet — page inventory will be absent');
  if (!readiness.hasLocale) hints.push('No locale set — volume lookups disabled');

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Keyword Strategy</h2>
          {hasMemo && <UpdatedAt value={memoUpdatedAt} />}
        </div>
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={archived || state === 'minting'}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1c2d4a] hover:bg-[#0f1d30] text-white disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {label}
        </button>
      </div>

      {hints.length > 0 && (
        <ul className="mb-3 space-y-0.5 text-[11px] text-gray-400 dark:text-white/40">
          {hints.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      )}

      {regenerating && (
        <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
          Waiting for the new strategy document to be posted back…
          {hasMemo ? ' The document below is the previous version.' : ''}
        </p>
      )}

      {hasMemo ? (
        <div className="mt-1">
          <KeywordMemoMarkdown source={memoMarkdown!} />
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-white/50">
          No keyword strategy yet — click{' '}
          <strong className="font-semibold text-gray-700 dark:text-white/80">Generate strategy prompt</strong>, run
          the er-handoff-memo skill, and the strategy document will appear here.
        </p>
      )}
    </div>
  );
}
