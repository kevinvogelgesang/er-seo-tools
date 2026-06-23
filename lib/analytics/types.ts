// Analytics provider contract types for GA4, GSC, and Prospects

export type MetricWindow = { start: string; end: string };

export type SourceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unmapped' | 'auth' | 'quota' | 'error'; message?: string };

export interface Ga4Totals {
  sessions: number;
  engagedSessions: number;
  averageSessionDuration: number;
  eventsPerSession: number;
  bounceRate: number;
  keyEvents: number;
}

export interface Ga4Bundle {
  totals: Ga4Totals;
  comparisonTotals: Ga4Totals;
  sessionsSeries: { date: string; value: number }[];
  sessionsSeriesPrev: { date: string; value: number }[];
  landingPages: { path: string; sessions: number; keyEvents: number }[];
  cities: { city: string; sessions: number; keyEvents: number }[];
  newVsReturning: { label: string; sessions: number }[];
  devices: { label: string; sessions: number }[];
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscBundle {
  totals: GscTotals;
  comparisonTotals: GscTotals;
  clicksSeries: { date: string; value: number }[];
  clicksSeriesPrev: { date: string; value: number }[];
  impressionsSeries: { date: string; value: number }[];
  impressionsSeriesPrev: { date: string; value: number }[];
  positionSeries: { date: string; value: number }[];
  positionSeriesPrev: { date: string; value: number }[];
  queries: { query: string; position: number; positionPrev: number | null }[];
}

export interface ProspectsBundle {
  total: number;
  organic: number | null;
}

export interface PerformanceAnalyticsBundle {
  period: MetricWindow;
  comparison: MetricWindow;
  ga4: SourceResult<Ga4Bundle>;
  gsc: SourceResult<GscBundle>;
  prospects: SourceResult<ProspectsBundle>;
}
