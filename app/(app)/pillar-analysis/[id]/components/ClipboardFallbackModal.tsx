'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  payload: string;
  onClose: () => void;
}

export function ClipboardFallbackModal({ payload, onClose }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Auto-select the payload so Cmd+C / Ctrl+C just works.
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const tryExecCopy = () => {
    if (!textareaRef.current) return;
    textareaRef.current.select();
    try {
      const ok = document.execCommand('copy');
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // User can manually Cmd+C; nothing else to do.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clipboard-fallback-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-navy-card rounded-xl shadow-lg border border-gray-100 dark:border-navy-border p-6 max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="clipboard-fallback-title"
          className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white mb-2"
        >
          Copy Claude prompt
        </h2>
        <p className="text-sm text-gray-600 dark:text-white/70 mb-3">
          Your browser blocked automatic clipboard access. Press Cmd+C / Ctrl+C with the
          text below selected, or use the Copy button.
        </p>
        <textarea
          ref={textareaRef}
          readOnly
          value={payload}
          className="w-full h-48 p-3 font-mono text-xs bg-gray-50 dark:bg-navy-deep dark:text-white border border-gray-200 dark:border-navy-border rounded resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={tryExecCopy}
            className="px-4 py-2 bg-[#f5a623] text-[#1c2d4a] font-medium text-sm rounded hover:bg-[#e8971a]"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 dark:border-navy-border text-gray-700 dark:text-white/80 text-sm rounded hover:bg-gray-50 dark:hover:bg-navy-card/60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
