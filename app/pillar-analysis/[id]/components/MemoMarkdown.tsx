'use client';

// app/pillar-analysis/[id]/components/MemoMarkdown.tsx
//
// Renders the strategic memo (markdown) using react-markdown with custom
// component overrides that match the dashboard's typography. We deliberately
// do NOT enable rehype-raw — the memo is server-stored markdown that we
// trust as text, and disabling raw HTML keeps the rendering safe even if a
// future contributor changes the source path. Do not add `rehype-raw` here.

import React, { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mt-6 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="font-display font-semibold text-lg text-[#1c2d4a] dark:text-white mt-4">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-gray-700 dark:text-white/80 mt-2 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc ml-6 mt-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal ml-6 mt-2 space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="text-gray-700 dark:text-white/80">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[#1c2d4a] dark:text-white">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
};

export function MemoMarkdown({ source }: { source: string }) {
  return <ReactMarkdown components={components}>{source}</ReactMarkdown>;
}
