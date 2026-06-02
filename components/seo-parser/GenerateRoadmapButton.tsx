'use client';
import { useState } from 'react';
import { composeRoadmapPayload } from '@/lib/seo-roadmap-prompt';
import { emitMemoPollerTrigger } from '@/lib/memo-poller-events';

export function GenerateRoadmapButton({ sessionId, hasRoadmap }: { sessionId: string; hasRoadmap: boolean }) {
  const [state, setState] = useState<'idle' | 'minting' | 'copied' | 'mint-failed' | 'service-error'>('idle');
  const webappUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  const onClick = async () => {
    if (state === 'minting') return;
    setState('minting');
    try {
      const res = await fetch(`/api/seo-roadmap/by-session/${sessionId}/mint-token`, { method: 'POST' });
      if (res.status === 500) { setState('service-error'); setTimeout(() => setState('idle'), 4000); return; }
      if (!res.ok) { setState('mint-failed'); setTimeout(() => setState('idle'), 3000); return; }
      const { token, roadmapId } = (await res.json()) as { token: string; roadmapId: string };
      const payload = composeRoadmapPayload({ webappUrl, roadmapId, token });
      try {
        await navigator.clipboard.writeText(payload);
        setState('copied');
        emitMemoPollerTrigger();
        setTimeout(() => setState('idle'), 2000);
      } catch {
        window.prompt('Copy this prompt for the seo-audit-roadmap skill:', payload);
        emitMemoPollerTrigger();
        setState('idle');
      }
    } catch {
      setState('mint-failed'); setTimeout(() => setState('idle'), 3000);
    }
  };

  const label = state === 'minting' ? 'Minting…'
    : state === 'copied' ? 'Copied!'
    : state === 'mint-failed' ? 'Mint failed — retry'
    : state === 'service-error' ? 'Token service unavailable'
    : hasRoadmap ? 'Regenerate Roadmap' : 'Generate Roadmap';

  return (
    <button onClick={onClick} disabled={state === 'minting'}
      className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1c2d4a] hover:bg-[#0f1d30] text-white disabled:opacity-60">
      {label}
    </button>
  );
}
