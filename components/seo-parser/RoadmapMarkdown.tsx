'use client';

// components/seo-parser/RoadmapMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function RoadmapMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
