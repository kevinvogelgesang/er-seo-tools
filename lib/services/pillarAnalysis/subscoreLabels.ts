// lib/services/pillarAnalysis/subscoreLabels.ts
// Per-subscore semantic labels. Each function takes the score value (0-10)
// and a small context object, returns the human-readable label that
// communicates what THIS score means for THIS site.

export interface SubscoreContext {
  /** Count of in-scope informational pages (blog/news/resource) */
  informationalCount: number;
  /** Count of program-page anchors */
  programCount: number;
  /** Count of location-page anchors */
  locationCount: number;
  /** Count of clusters of size >= minClusterSize */
  validClusterCount: number;
}

export function contentVolumeLabel(value: number, ctx: SubscoreContext): string {
  if (ctx.informationalCount === 0) return 'No informational content';
  if (value === 0) return 'Below content floor (need 15+ posts)';
  if (value < 4) return 'Thin content base';
  if (value < 7) return 'Modest content depth';
  return 'Strong content depth';
}

export function topicalConcentrationLabel(_value: number, ctx: SubscoreContext): string {
  const n = ctx.validClusterCount;
  if (n === 0) return 'No coherent clusters formed';
  if (n >= 14) return `Over-fragmented (${n}+ clusters)`;
  if (n < 4) return `${n} cluster${n === 1 ? '' : 's'} (narrow range)`;
  if (n <= 8) return `${n} clusters (ideal spread)`;
  return `${n} clusters (slightly broad)`;
}

export function organicFootprintLabel(value: number, _ctx: SubscoreContext): string {
  if (value === 0) return 'No detectable GSC presence';
  if (value < 4) return 'Minimal latent demand';
  if (value < 7) return 'Moderate search visibility';
  return 'Strong latent demand to harvest';
}

export function internalLinkGapLabel(value: number, _ctx: SubscoreContext): string {
  if (value < 2) return 'Already well-linked (low pillar leverage)';
  if (value < 4) return 'Modestly linked (some leverage)';
  if (value < 7) return 'Some pillar leverage';
  return 'Sparse internal linking (high pillar leverage)';
}

export function programPageClarityLabel(value: number, ctx: SubscoreContext): string {
  if (ctx.programCount === 0) return 'No program pages detected';
  if (value < 4) return 'Program intent ambiguous';
  if (value < 7) return 'Program intent partially clear';
  return 'Program anchors strongly classified';
}

export function backlinkDistributionLabel(value: number, _ctx: SubscoreContext): string {
  if (value === 0) return 'Backlinks evenly distributed (or absent)';
  if (value < 4) return 'Backlinks evenly spread';
  if (value < 7) return 'Moderate backlink variance';
  return 'Concentrated backlinks (consolidation opportunity)';
}

// Convenience map for the dashboard component.
export const SUBSCORE_LABEL_FUNCTIONS = {
  contentVolume: contentVolumeLabel,
  topicalConcentration: topicalConcentrationLabel,
  organicFootprint: organicFootprintLabel,
  internalLinkGap: internalLinkGapLabel,
  programPageClarity: programPageClarityLabel,
  backlinkDistribution: backlinkDistributionLabel,
} as const;
