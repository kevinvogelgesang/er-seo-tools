'use client';

// components/keyword-research/KeywordMemoMarkdown.tsx
//
// Renders the keyword strategy memo (markdown) using react-markdown with custom
// component overrides that mirror RoadmapMarkdown's typography. A decoupled copy
// of components/seo-parser/RoadmapMarkdown.tsx so the keyword-research feature
// can evolve its rendering independently. We deliberately do NOT enable
// rehype-raw — the memo is server-stored markdown that we trust as text, and
// disabling raw HTML keeps the rendering safe. Do not add `rehype-raw`.

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
  code: ({ children }: { children?: ReactNode }) => (
    <code className="font-mono text-[0.875em] bg-gray-100 dark:bg-navy-deep text-[#1c2d4a] dark:text-white px-1.5 py-0.5 rounded border border-gray-200 dark:border-navy-border">
      {children}
    </code>
  ),
};

export function KeywordMemoMarkdown({ source }: { source: string }) {
  return <ReactMarkdown components={components}>{source}</ReactMarkdown>;
}
