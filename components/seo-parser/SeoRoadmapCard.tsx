'use client';

// components/seo-parser/SeoRoadmapCard.tsx
//
// Renders the Technical SEO Roadmap card on the SEO parser results page.
// Composes the GenerateRoadmapButton (header) + RoadmapMarkdown (body) and
// mounts a poller whose wiring is copied from
// app/pillar-analysis/[id]/components/MemoPoller.tsx.
//
// Auto-start rule (differs from pillar): the poller auto-starts on mount ONLY
// when initialStatus === 'processing'. Roadmap rows are lazy/manual, so a null
// markdown value alone is NOT enough to auto-start. The poller also starts
// whenever the GenerateRoadmapButton emits onMemoPollerTrigger after a mint.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPollingMachine } from '@/lib/memo-poller-machine';
import { onMemoPollerTrigger } from '@/lib/memo-poller-events';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';
import { GenerateRoadmapButton } from './GenerateRoadmapButton';
import { RoadmapMarkdown } from './RoadmapMarkdown';

const POLL_INTERVAL_MS = 3000;
const LIFETIME_MS = 15 * 60 * 1000;

interface Props {
  sessionId: string;
  initialStatus: string;
  initialRoadmapMarkdown: string | null;
  initialRoadmapUpdatedAt: string | null;
  /** ISO time the current token was minted; anchors the poll window to mint
   * time so a stale 'processing' row doesn't restart a 15-min cycle on reload. */
  initialTokenMintedAt: string | null;
}

// Hydration-safe relative timestamp. Mirrors RelativeTime from pillar-analysis:
// renders null on the first (server + initial client) render, then the
// localized string after mount, so there is nothing for the client to mismatch.
function RoadmapUpdatedAt({ value, className }: { value: string | null; className?: string }) {
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

export function SeoRoadmapCard({
  sessionId,
  initialStatus,
  initialRoadmapMarkdown,
  initialRoadmapUpdatedAt,
  initialTokenMintedAt,
}: Props) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);

  const hasRoadmap = initialRoadmapMarkdown != null && initialRoadmapMarkdown.length > 0;

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
  const baselineRef = useRef<string | null>(initialRoadmapUpdatedAt);

  // Sync baselineRef from the prop after router.refresh() updates it, but only
  // while idle — an active cycle owns the baseline it started with.
  useEffect(() => {
    if (machine.status() === 'idle') {
      baselineRef.current = initialRoadmapUpdatedAt;
    }
  }, [initialRoadmapUpdatedAt, machine]);

  // Visibility tracking
  useEffect(() => {
    const onVisibility = () => {
      machine.setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [machine]);

  // Trigger event subscription (GenerateRoadmapButton emits after a mint)
  useEffect(() => {
    return onMemoPollerTrigger(() => {
      machine.start({ baseline: baselineRef.current, now: Date.now() });
      setExpired(false);
    });
  }, [machine]);

  const hasAutoStartedRef = useRef(false);

  // Auto-start on mount ONLY when a generation is already in flight. Anchor the
  // poll window to mint time, not page-load time: a 'processing' row whose token
  // window already elapsed (skill never wrote back) must NOT restart a fresh
  // 15-minute poll cycle on every reload — show the expired state instead.
  useEffect(() => {
    if (initialStatus === 'processing' && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      const mintedMs = initialTokenMintedAt ? new Date(initialTokenMintedAt).getTime() : null;
      if (mintedMs != null && Date.now() - mintedMs >= LIFETIME_MS) {
        setExpired(true);
      } else {
        machine.start({ baseline: initialRoadmapUpdatedAt, now: mintedMs ?? Date.now() });
        setExpired(false);
      }
    }
  }, [initialStatus, initialRoadmapUpdatedAt, initialTokenMintedAt, machine]);

  // Polling loop
  useEffect(() => {
    const interval = setInterval(async () => {
      if (machine.status() !== 'polling') return;
      try {
        const res = await fetch(`/api/seo-roadmap/by-session/${sessionId}`);
        if (!res.ok) return;
        const body = await res.json();
        const latest: string | null = body?.seoRoadmap?.roadmapUpdatedAt ?? null;
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
      id="seo-roadmap"
      className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 scroll-mt-28"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white">
            Technical SEO Roadmap
          </h2>
          {hasRoadmap && (
            <RoadmapUpdatedAt
              value={initialRoadmapUpdatedAt}
              className="text-sm text-gray-500 dark:text-white/50"
            />
          )}
        </div>
        <GenerateRoadmapButton sessionId={sessionId} hasRoadmap={hasRoadmap} />
      </header>

      {hasRoadmap ? (
        <div className="mt-2">
          <RoadmapMarkdown source={initialRoadmapMarkdown!} />
        </div>
      ) : (
        <p className="mt-2 text-gray-700 dark:text-white/80 leading-relaxed">
          No roadmap yet — click <strong className="font-semibold text-[#1c2d4a] dark:text-white">Generate Roadmap</strong> to create one via Claude.
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
            Check for roadmap
          </button>
        </div>
      )}
    </section>
  );
}
