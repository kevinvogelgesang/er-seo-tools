// lib/widgets/registry.tsx
// Authoritative list of homepage widgets + the default layout. PR 3 adds
// edit/persistence; PR 3.5 adds the KPI strip + Needs-attention aggregate
// widgets (loaders verified — /api/fleet/kpi + /api/fleet/needs-attention over
// getClientFleet). Registry is authoritative: a browser with a stored layout
// gets any newly registered id appended at defaultSize (normalizeLayout), so
// existing users see the two new widgets at the END until they Reset layout —
// no version bump for a purely additive change.
import type { WidgetDef, LayoutItem } from './types'
import { LiveNowWidget } from '@/components/widgets/LiveNowWidget'
import { RecentParsesWidget } from '@/components/widgets/RecentParsesWidget'
import { QuarterWeekWidget } from '@/components/widgets/QuarterWeekWidget'
import { QuickSiteAuditWidget } from '@/components/widgets/QuickSiteAuditWidget'
import { QuickParserWidget } from '@/components/widgets/QuickParserWidget'
import { QuickReportWidget } from '@/components/widgets/QuickReportWidget'
import { QuickRobotsWidget } from '@/components/widgets/QuickRobotsWidget'
import { KpiStripWidget } from '@/components/widgets/KpiStripWidget'
import { NeedsAttentionWidget } from '@/components/widgets/NeedsAttentionWidget'

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi-strip', title: 'Fleet at a glance', sizes: ['wide', 'xl'], defaultSize: 'xl', Component: KpiStripWidget },
  { id: 'live-now', title: 'Live now', sizes: ['sm', 'wide', 'lg'], defaultSize: 'lg', Component: LiveNowWidget },
  { id: 'needs-attention', title: 'Needs attention', sizes: ['sm', 'lg'], defaultSize: 'lg', Component: NeedsAttentionWidget },
  { id: 'quick-site-audit', title: 'Start a site audit', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickSiteAuditWidget },
  { id: 'quick-parser', title: 'Parse a Screaming Frog export', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickParserWidget },
  { id: 'quick-report', title: 'Generate a performance report', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickReportWidget },
  { id: 'quarter-week', title: 'Quarter Grid — this week', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuarterWeekWidget },
  { id: 'recent-parses', title: 'Recent parses', sizes: ['sm', 'lg'], defaultSize: 'lg', Component: RecentParsesWidget },
  { id: 'quick-robots', title: 'Check robots.txt', sizes: ['sm'], defaultSize: 'sm', Component: QuickRobotsWidget },
]

// Default display order. KPI strip is the full-width banner up top, then the
// live queue + worst-movers, then the quick-start cards. Grid auto-flow packs
// the spans.
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'kpi-strip', size: 'xl' },
  { id: 'live-now', size: 'lg' },
  { id: 'needs-attention', size: 'lg' },
  { id: 'quick-site-audit', size: 'wide' },
  { id: 'quick-parser', size: 'wide' },
  { id: 'quick-report', size: 'wide' },
  { id: 'quarter-week', size: 'wide' },
  { id: 'recent-parses', size: 'lg' },
  { id: 'quick-robots', size: 'sm' },
]
