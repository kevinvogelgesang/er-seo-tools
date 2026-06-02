'use client';

import { useState } from 'react';
import { AggregatedResult } from '@/lib/types';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';

export function CopyToClipboard({ result }: { result: AggregatedResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const payload = buildTechnicalAuditExport(result);
    const text =
      `Run the seo-audit-roadmap skill on the SEO audit payload below.\n` +
      `Affected URLs are compact refs in url_registry; each issue's affectedUrlSource ` +
      `says whether its set is complete ('derived-page-index') or a sample ('parser-sample').\n\n` +
      '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
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
          : 'bg-[#c07f2a] hover:bg-[#a86e22] text-white'
      }`}
    >
      {copied ? 'Copied!' : 'Copy for Claude'}
    </button>
  );
}
