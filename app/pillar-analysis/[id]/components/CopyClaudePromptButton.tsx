'use client';

import { useState } from 'react';
import { composePayload } from '@/lib/pillar-prompt';
import { emitMemoPollerTrigger } from '@/lib/memo-poller-events';
import { ClipboardFallbackModal } from './ClipboardFallbackModal';

interface Props {
  analysisId: string;
  status: string; // 'pending' | 'running' | 'complete' | 'error'
  webappUrl: string;
  hasMemo: boolean;
}

type ButtonState = 'idle' | 'minting' | 'copied' | 'mint-failed' | 'service-error';

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'bg-[#f5a623] text-[#1c2d4a] hover:bg-[#e8971a]',
  minting: 'bg-gray-300 text-gray-600 cursor-wait',
  copied: 'bg-green-500 text-white',
  'mint-failed': 'bg-red-500 text-white',
  'service-error': 'bg-red-700 text-white',
};

function idleLabel(hasMemo: boolean): string {
  return hasMemo ? 'Regenerate via Claude' : 'Copy Claude Prompt';
}

function stateLabel(state: ButtonState, hasMemo: boolean): string {
  switch (state) {
    case 'idle': return idleLabel(hasMemo);
    case 'minting': return 'Minting…';
    case 'copied': return 'Copied!';
    case 'mint-failed': return 'Mint failed — retry';
    case 'service-error': return 'Token service unavailable';
  }
}

export function CopyClaudePromptButton({ analysisId, status, webappUrl, hasMemo }: Props) {
  const [state, setState] = useState<ButtonState>('idle');
  const [fallbackPayload, setFallbackPayload] = useState<string | null>(null);

  const disabled = status !== 'complete' || state === 'minting';

  const onClick = async () => {
    if (disabled) return;
    setState('minting');
    try {
      const res = await fetch(`/api/pillar-analysis/${analysisId}/mint-token`, {
        method: 'POST',
      });
      if (res.status === 500) {
        setState('service-error');
        setTimeout(() => setState('idle'), 4000);
        return;
      }
      if (!res.ok) {
        setState('mint-failed');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      const payload = composePayload({ webappUrl, analysisId, token });

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(payload);
          setState('copied');
          emitMemoPollerTrigger();
          setTimeout(() => setState('idle'), 2000);
        } catch {
          setFallbackPayload(payload);
          emitMemoPollerTrigger();
          setState('idle');
        }
      } else {
        setFallbackPayload(payload);
        emitMemoPollerTrigger();
        setState('idle');
      }
    } catch {
      setState('mint-failed');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const tooltip = status !== 'complete'
    ? `Available once analysis completes (current status: ${status})`
    : '';

  return (
    <>
      <button
        id="copy-prompt"
        onClick={onClick}
        disabled={disabled}
        title={tooltip}
        className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
          disabled ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : STATE_CLASSES[state]
        }`}
      >
        {disabled && state === 'idle' ? idleLabel(hasMemo) : stateLabel(state, hasMemo)}
      </button>
      {fallbackPayload && (
        <ClipboardFallbackModal
          payload={fallbackPayload}
          onClose={() => setFallbackPayload(null)}
        />
      )}
    </>
  );
}
