'use client';

import { useEffect, useState } from 'react';

interface ShareModalProps {
  sessionId: string;
  onClose: () => void;
}

type ShareState =
  | { status: 'loading' }
  | { status: 'success'; shareUrl: string; expiresAt: string }
  | { status: 'error'; message: string };

export function ShareModal({ sessionId, onClose }: ShareModalProps) {
  const [state, setState] = useState<ShareState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to create share link');
        }
        return res.json() as Promise<{ token: string; shareUrl: string; expiresAt: string }>;
      })
      .then(({ shareUrl, expiresAt }) => {
        // Ensure the URL is absolute using the current window origin
        const absoluteUrl = shareUrl.startsWith('http')
          ? shareUrl
          : `${window.location.origin}${shareUrl}`;
        setState({ status: 'success', shareUrl: absoluteUrl, expiresAt });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error occurred',
        });
      });

    return () => controller.abort();
  }, [sessionId, attempt]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleCopy = () => {
    if (state.status !== 'success') return;
    void navigator.clipboard.writeText(state.shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formattedExpiry =
    state.status === 'success'
      ? new Date(state.expiresAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-display font-bold text-[#1c2d4a] text-lg">Share Report</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {state.status === 'loading' && (
            <div className="flex items-center gap-3 text-gray-600">
              <svg
                className="w-5 h-5 animate-spin text-[#1c2d4a]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm">Generating share link…</span>
            </div>
          )}

          {state.status === 'error' && (
            <div className="space-y-3">
              <div className="text-sm text-red-700 bg-red-50 rounded-lg p-4 border border-red-200">
                {state.message}
              </div>
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="text-sm text-[#1c2d4a] font-medium hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {state.status === 'success' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Anyone with this link can view a read-only version of this report. The link expires
                on <span className="font-medium text-gray-800">{formattedExpiry}</span>.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={state.shareUrl}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-700 font-mono truncate focus:outline-none focus:ring-2 focus:ring-[#1c2d4a]/20"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    copied
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-[#1c2d4a] text-white hover:bg-[#0f1d30]'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
