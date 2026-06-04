'use client';

// app/pillar-analysis/[id]/components/MemoMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function MemoMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
