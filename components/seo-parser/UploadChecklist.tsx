'use client';
import React from 'react';

const RECOMMENDED = [
  { file: 'internal_all.csv', why: 'Core crawl: titles, H1s, meta, status, depth, indexability' },
  { file: 'response_codes_*.csv', why: 'Broken pages / redirects' },
  { file: 'page_titles_*.csv / meta_description_*.csv / h1_*.csv', why: 'Duplicate & missing SEO elements' },
  { file: 'images_missing_alt_text.csv', why: 'Accessibility & image SEO' },
  { file: 'pagespeed_*.csv', why: 'Core Web Vitals / performance' },
  { file: 'search_console_*.csv', why: 'Clicks / impressions / position' },
  { file: 'SEMRush Organic Positions (optional)', why: 'Keyword signals: cannibalization, quick wins' },
];

export function UploadChecklist() {
  return (
    <details className="text-sm text-gray-600 dark:text-white/60">
      <summary className="cursor-pointer font-medium text-[#1c2d4a] dark:text-white">Which files should I upload?</summary>
      <ul className="mt-2 space-y-1">
        {RECOMMENDED.map((r) => (
          <li key={r.file}><code className="text-xs">{r.file}</code> — {r.why}</li>
        ))}
      </ul>
    </details>
  );
}
