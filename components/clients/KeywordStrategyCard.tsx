'use client';

// components/clients/KeywordStrategyCard.tsx
//
// KS-5 §9 — client-dashboard card for the keyword-strategy handoff. Slots
// immediately after KeywordProfileCard on /clients/[id]. It:
//   • renders the latest posted-back memo (reusing KeywordMemoMarkdown), and
//   • mints a `kst_` token, composes the clipboard prompt, and polls the
//     cookie-gated GET route for the skill's memo write-back.
//
// D1 PR3 Task 15: the poller wiring (timers, visibilitychange, SSE
// subscription, auto-start/restart) now lives in useMemoPoller (Task 12) —
// this card keeps only its local-state shell (it owns its memo in local
// state and updates it from the poll response on change, unlike the
// router.refresh()-based MemoHandoffCard cards; the dashboard page is a big
// server component, so a targeted local update is cheaper and keeps the
// change-detection self-contained). The card ignores the hook's `expired`
// flag by design — it has never had an expired banner and must not grow one.

import { useCallback, useRef, useState, useEffect } from 'react';
import { useMemoPoller } from '@/components/handoff/useMemoPoller';
import { composeKeywordStrategyPayload } from '@/lib/keyword-strategy-prompt';
import { KeywordMemoMarkdown } from '@/components/keyword-research/KeywordMemoMarkdown';

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

  // The freshest fetched session lives in a ref purely as a call-time cache
  // for the hook's onChange/fetchLatestUpdatedAt closures.
  const latestSessionRef = useRef<KeywordStrategySessionInit | null>(initialSession);

  // A5 Task 24: the topic this card subscribes to is THIS model's own id
  // (there's no separate parser-Session FK — the strategy session IS the
  // identity), and that identity changes on every regenerate (a new
  // KeywordStrategySession row per mint). Tracked in state so the SSE
  // subscription effect re-subscribes to the new id after each mint.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSession?.id ?? null);

  // clientId rarely changes for a mounted card, but kept in a ref (rather
  // than captured directly) so fetchLatestSession can stay referentially
  // stable (empty deps) — safe to close over once in the hook's lazily-created
  // machine.
  const clientIdRef = useRef(clientId);
  useEffect(() => {
    clientIdRef.current = clientId;
  });

  // undefined = the fetch failed (network/HTTP error) — caller should leave
  // state as-is and let the next tick/invalidate retry.
  const fetchLatestSession = useCallback(async (): Promise<KeywordStrategySessionInit | null | undefined> => {
    try {
      const res = await fetch(`/api/clients/${clientIdRef.current}/keyword-strategy`);
      if (!res.ok) return undefined;
      const body = await res.json();
      return (body?.session ?? null) as KeywordStrategySessionInit | null;
    } catch {
      return undefined;
    }
  }, []);

  // The hook owns the machine, timers, visibilitychange, and SSE subscription
  // (topicId '' subscribes to nothing, before the first mint). onChange and
  // fetchLatestUpdatedAt both fetch AT CALL TIME — whether that's immediate
  // (tab visible) or deferred to visibility-resume (was hidden when an SSE
  // push arrived) — reading a pre-fetched ref would risk applying stale data
  // on the invalidate() path. Unlike the router.refresh()-based memo cards,
  // this card manages its memo in local state, so onChange applies the fetch
  // result directly rather than reaching into the hook's baseline (that's
  // the hook's job now — see restart({ baselineNull: true }) below).
  const { restart } = useMemoPoller({
    topicId: activeSessionId ?? '',
    onChange: () => {
      void (async () => {
        const s = await fetchLatestSession();
        if (s === undefined) return; // couldn't refresh; next tick/invalidate retries
        latestSessionRef.current = s;
        setMemoMarkdown(s?.memoMarkdown ?? null);
        setMemoUpdatedAt(s?.memoUpdatedAt ?? null);
        setRegenerating(false);
      })();
    },
    fetchLatestUpdatedAt: async () => {
      const s = await fetchLatestSession();
      if (s === undefined) return undefined; // couldn't refresh; the tick is skipped
      latestSessionRef.current = s;
      return s?.memoUpdatedAt ?? null;
    },
    initialBaseline: initialSession?.memoUpdatedAt ?? null,
    // Auto-start on mount only when a generation is already in flight,
    // anchored to mint time so a stale 'processing' row doesn't restart a
    // fresh 15-min cycle.
    autoStart: {
      active: initialSession?.status === 'processing',
      mintedAt: initialSession?.tokenMintedAt ?? null,
    },
  });

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
      restart({ baselineNull: true });
      setRegenerating(true);
      // Re-subscribe the SSE topic to the NEW session id (a regenerate mints
      // a fresh KeywordStrategySession row — the old topic will never fire
      // for this cycle's write-back).
      setActiveSessionId(strategyId);
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
