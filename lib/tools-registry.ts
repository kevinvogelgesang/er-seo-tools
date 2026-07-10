// lib/tools-registry.ts
// A6-absorbed single source of truth for the app-shell nav (spec §3.1).
// Homepage tool cards (PR 2) and search will render from this too.
import type { ComponentType } from 'react'
import {
  IconHome, IconClients, IconSiteAudit, IconParser, IconReports,
  IconRobots, IconQuarter, IconChecklist, IconRedirect, IconBook, IconSettings,
  IconProspect,
} from '@/components/shell/icons'

export type NavGroupId = 'overview' | 'run' | 'plan' | 'reference'

export interface ToolDef {
  id: string
  name: string
  href: string
  // C16: additional path prefixes owned by this tool — toolForPathname treats
  // them like href so retained routes (/seo-audits/results/*, /seo-audits/diff)
  // resolve to the merged entry for Topbar titles + sidebar active state.
  aliases?: string[]
  group: NavGroupId | 'footer'
  icon: ComponentType<{ className?: string }>
  description: string
  children?: { name: string; href: string }[]
  // Codex plan-fix 3: hidden tools get no nav entry but still resolve via
  // toolForPathname so the Topbar titles their pages correctly.
  hidden?: boolean
}

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'run', label: 'Run' },
  { id: 'plan', label: 'Plan' },
  { id: 'reference', label: 'Reference' },
]

export const TOOLS: ToolDef[] = [
  { id: 'home', name: 'Home', href: '/', group: 'overview', icon: IconHome, description: 'Quick-start dashboard' },
  {
    id: 'clients', name: 'Clients', href: '/clients', group: 'overview', icon: IconClients,
    description: 'Fleet scores, timelines & schedules',
    children: [
      { name: 'Fleet', href: '/clients' },
      { name: 'Manage clients', href: '/clients/manage' },
    ],
  },
  {
    id: 'audits', name: 'Audits', href: '/ada-audit', aliases: ['/seo-audits'], group: 'run', icon: IconSiteAudit,
    description: 'Site, single-page & SF-upload audits — ADA + SEO',
    children: [
      { name: 'Run an audit', href: '/ada-audit' },
      { name: 'Audit queue', href: '/ada-audit/queue' },
      { name: 'Recents', href: '/ada-audit/recents' },
      { name: 'Compare crawls', href: '/seo-audits/diff' },
    ],
  },
  {
    id: 'sales',
    name: 'Prospect Scans',
    href: '/sales',
    group: 'run',
    icon: IconProspect,
    description: 'Scan a prospect site & share a sales report link',
  },
  { id: 'reports', name: 'SEO Reports', href: '/reports', group: 'run', icon: IconReports, description: 'GA4 + GSC branded client PDFs' },
  { id: 'robots-validator', name: 'Robots Validator', href: '/robots-validator', group: 'run', icon: IconRobots, description: 'robots.txt, sitemaps & AI-bot access' },
  { id: 'quarter-grid', name: 'Quarter Grid', href: '/quarter-grid', group: 'plan', icon: IconQuarter, description: 'Plan ~30 clients, push to Teamwork' },
  {
    id: 'eat-checklist', name: 'E-E-A-T Checklists', href: '/eat-checklist', group: 'plan', icon: IconChecklist,
    description: 'Content quality & audit checklists',
    children: [
      { name: 'Checklist', href: '/eat-checklist' },
      { name: 'Audit checklist', href: '/eat-checklist/audit' },
    ],
  },
  { id: 'rankmath-redirects', name: 'RankMath Redirects', href: '/rankmath-redirects', group: 'reference', icon: IconRedirect, description: 'WordPress redirect migration runbook' },
  { id: 'oxygen-guide', name: 'Oxygen Guide', href: '/oxygen-tailwind-guide', group: 'reference', icon: IconBook, description: 'Oxygen + Tailwind stack guide' },
  { id: 'settings', name: 'Settings', href: '/settings', group: 'footer', icon: IconSettings, description: 'Google connection & scoring weights' },
  // Hidden: shell-wrapped pages reached from flows, not from the nav.
  { id: 'keyword-research', name: 'Keyword Research', href: '/keyword-research', group: 'run', icon: IconParser, description: 'Keyword research sessions', hidden: true },
  { id: 'pillar-analysis', name: 'Pillar Analysis', href: '/pillar-analysis', group: 'run', icon: IconParser, description: 'Pillar analysis dashboards', hidden: true },
  { id: 'admin', name: 'Ops', href: '/admin', group: 'footer', icon: IconSettings, description: 'System health & operations', hidden: true },
]

// Longest-prefix match over href + aliases so /ada-audit/queue AND
// /seo-audits/diff both → 'audits'; '/' is exact-only.
export function toolForPathname(pathname: string): ToolDef | undefined {
  let best: ToolDef | undefined
  let bestLen = -1
  for (const t of TOOLS) {
    for (const prefix of [t.href, ...(t.aliases ?? [])]) {
      if (prefix === '/') {
        if (pathname === '/') return t
        continue
      }
      if ((pathname === prefix || pathname.startsWith(prefix + '/')) && prefix.length > bestLen) {
        best = t
        bestLen = prefix.length
      }
    }
  }
  return best
}
