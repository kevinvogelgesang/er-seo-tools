'use client';

// components/keyword-research/KeywordMemoCard.tsx
//
// Renders the Keyword Strategy Memo card on the keyword-research results page.
// Composes the GenerateKeywordMemoButton (header) + KeywordMemoMarkdown (body)
// and mounts a poller whose wiring is copied from
// components/seo-parser/SeoRoadmapCard.tsx.
//
// Auto-start rule: the poller auto-starts on mount ONLY when
// initialStatus === 'processing'. Memo rows are lazy/manual, so a null markdown
// value alone is NOT enough to auto-start. The poller also starts whenever the
// GenerateKeywordMemoButton emits onMemoPollerTrigger after a mint.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPollingMachine } from '@/lib/memo-poller-machine';
import { onMemoPollerTrigger } from '@/lib/memo-poller-events';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';
import { GenerateKeywordMemoButton } from './GenerateKeywordMemoButton';
import { KeywordMemoMarkdown } from './KeywordMemoMarkdown';

const POLL_INTERVAL_MS = 3000;
const LIFETIME_MS = 15 * 60 * 1000;

interface Props {
  sessionId: string;
  initialStatus: string;
  initialMemoMarkdown: string | null;
  initialMemoUpdatedAt: string | null;
}

// Hydration-safe relative timestamp. Renders null on the first (server + initial
// client) render, then the localized string after mount, so there is nothing for
// the client to mismatch.
function MemoUpdatedAt({ value, className }: { value: string | null; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted || value == null) return null;

  const date = new Date(value);
  const relative = formatRelativeTime(date, now);
  const absolute = formatAbsoluteTime(date);
  if (relative == null || absolute == null) return null;

  return (
    <span className={className} title={absolute}>
      {relative}
    </span>
  );
}

export function KeywordMemoCard({
  sessionId,
  initialStatus,
  initialMemoMarkdown,
  initialMemoUpdatedAt,
}: Props) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);

  const hasMemo = initialMemoMarkdown != null && initialMemoMarkdown.length > 0;

  // Capture router via ref so the machine's onChange closure (created once)
  // always reads the current router instance.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const machineRef = useRef<ReturnType<typeof createPollingMachine> | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPollingMachine({
      onChange: () => routerRef.current.refresh(),
      lifetimeMs: LIFETIME_MS,
    });
  }
  const machine = machineRef.current;

  // Latest baseline tracking via ref so closures see fresh values.
  const baselineRef = useRef<string | null>(initialMemoUpdatedAt);

  // Sync baselineRef from the prop after router.refresh() updates it, but only
  // while idle — an active cycle owns the baseline it started with.
  useEffect(() => {
    if (machine.status() === 'idle') {
      baselineRef.current = initialMemoUpdatedAt;
    }
  }, [initialMemoUpdatedAt, machine]);

  // Visibility tracking
  useEffect(() => {
    const onVisibility = () => {
      machine.setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [machine]);

  // Trigger event subscription (GenerateKeywordMemoButton emits after a mint)
  useEffect(() => {
    return onMemoPollerTrigger(() => {
      machine.start({ baseline: baselineRef.current, now: Date.now() });
      setExpired(false);
    });
  }, [machine]);

  const hasAutoStartedRef = useRef(false);

  // Auto-start on mount ONLY when a generation is already in flight.
  useEffect(() => {
    if (initialStatus === 'processing' && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      machine.start({ baseline: initialMemoUpdatedAt, now: Date.now() });
      setExpired(false);
    }
  }, [initialStatus, initialMemoUpdatedAt, machine]);

  // Polling loop
  useEffect(() => {
    const interval = setInterval(async () => {
      if (machine.status() !== 'polling') return;
      try {
        const res = await fetch(`/api/keyword-memo/by-session/${sessionId}`);
        if (!res.ok) return;
        const body = await res.json();
        const latest: string | null = body?.keywordResearch?.memoUpdatedAt ?? null;
        baselineRef.current = baselineRef.current ?? latest; // first response sets baseline if missing
        machine.tick({ latestUpdatedAt: latest, now: Date.now() });
        if (machine.status() === 'expired') setExpired(true);
      } catch {
        // Network errors are silent — next tick will retry.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, machine]);

  return (
    <section
      id="keyword-memo"
      className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 scroll-mt-28"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white">
            Keyword Strategy Memo
          </h2>
          {hasMemo && (
            <MemoUpdatedAt
              value={initialMemoUpdatedAt}
              className="text-sm text-gray-500 dark:text-white/50"
            />
          )}
        </div>
        <GenerateKeywordMemoButton sessionId={sessionId} hasMemo={hasMemo} />
      </header>

      {hasMemo ? (
        <div className="mt-2">
          <KeywordMemoMarkdown source={initialMemoMarkdown!} />
        </div>
      ) : (
        <p className="mt-2 text-gray-700 dark:text-white/80 leading-relaxed">
          No keyword memo yet — click <strong className="font-semibold text-[#1c2d4a] dark:text-white">Generate Keyword Memo</strong> to create one via Claude.
        </p>
      )}

      {expired && (
        <div className="mt-4 text-sm text-gray-500 dark:text-white/50">
          Stopped checking after 15 minutes.{' '}
          <button
            type="button"
            onClick={() => {
              machine.start({ baseline: baselineRef.current, now: Date.now() });
              setExpired(false);
            }}
            className="underline hover:text-[#1c2d4a] dark:hover:text-white"
          >
            Check for memo
          </button>
        </div>
      )}
    </section>
  );
}
