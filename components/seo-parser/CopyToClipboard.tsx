'use client';

import { useState } from 'react';
import { AggregatedResult } from '@/lib/types';

export function CopyToClipboard({ result }: { result: AggregatedResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = JSON.stringify(result, null, 2);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-999999px;top:-999999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Failed to copy to clipboard');
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
        copied
          ? 'bg-green-600 text-white'
          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      }`}
    >
      {copied ? 'Copied!' : 'Copy JSON'}
    </button>
  );
}
