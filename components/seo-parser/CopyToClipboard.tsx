'use client';

import { useState } from 'react';
import { AggregatedResult } from '@/lib/types';

export function CopyToClipboard({ result }: { result: AggregatedResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = JSON.stringify(result, null, 2);
    try {
      await navigator.clipboard.writeText(text);
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
