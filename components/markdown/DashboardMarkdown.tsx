'use client';

// components/markdown/DashboardMarkdown.tsx
//
// The single shared markdown renderer for dashboard documents (technical-SEO
// roadmaps, pillar strategic memos, keyword strategy memos). Uses react-markdown
// with custom component overrides for the dashboard's typography PLUS GFM tables.
//
// We deliberately do NOT enable `rehype-raw`: these documents are server-stored
// markdown that we trust as text only. `remark-gfm` widens the markdown surface
// (tables, strikethrough, autolinks) but still does not execute raw HTML. Do not
// add `rehype-raw` here — a render test asserts raw HTML stays inert.

import React, { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="font-mono text-[0.875em] bg-gray-100 dark:bg-navy-deep text-[#1c2d4a] dark:text-white px-1.5 py-0.5 rounded border border-gray-200 dark:border-navy-border">
      {children}
    </code>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-gray-50 dark:bg-navy-deep">{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="border-b border-gray-200 dark:border-navy-border">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="text-left font-semibold text-[#1c2d4a] dark:text-white px-3 py-2 border-b border-gray-200 dark:border-navy-border">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="text-gray-700 dark:text-white/80 px-3 py-2 align-top">{children}</td>
  ),
};

export function DashboardMarkdown({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{source}</ReactMarkdown>;
}
