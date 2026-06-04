'use client';

// components/keyword-research/KeywordMemoMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function KeywordMemoMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
