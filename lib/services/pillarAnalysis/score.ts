// lib/services/pillarAnalysis/score.ts
import type { UrlRecord, SubscoreBreakdown, SubscorePresence } from './types';
import type { PillarConfig } from './config';
import type { SubscoreContext } from './subscoreLabels';

export interface FitScoreResult {
  score: number;             // 1-10
  subscores: SubscoreBreakdown;
  subscorePresence: SubscorePresence;
  subscoreContext: SubscoreContext;
  dataCompleteness: number;  // 0.0-1.0
}

export function computeFitScore(records: UrlRecord[], cfg: PillarConfig): FitScoreResult {
  const informational = records.filter(
    (r) => r.intentClass === 'informational' && (r.pageType === 'blog' || r.pageType === 'news' || r.pageType === 'resource'),
  );
  const programs = records.filter((r) => r.pageType === 'program');
  const locations = records.filter((r) => r.pageType === 'location');

  // Count clusters of size >= minClusterSize. Mirrors the logic in
  // topicalConcentrationScore so context and score stay consistent.
  const clusterSizes = new Map<number, number>();
  for (const r of informational) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    clusterSizes.set(r.topicClusterId, (clusterSizes.get(r.topicClusterId) ?? 0) + 1);
  }
  const validClusterCount = Array.from(clusterSizes.values())
    .filter((c) => c >= cfg.minClusterSize).length;

  const subscoreContext: SubscoreContext = {
    informationalCount: informational.length,
    programCount: programs.length,
    locationCount: locations.length,
    validClusterCount,
  };

  const subs: SubscoreBreakdown = {
    contentVolume: contentVolumeScore(informational.length),
    topicalConcentration: topicalConcentrationScore(informational, cfg),
    organicFootprint: organicFootprintScore(informational),
    internalLinkGap: internalLinkGapScore(informational),
    programPageClarity: programPageClarityScore(programs),
    backlinkDistribution: backlinkDistributionScore(informational),
  };

  // Data-completeness audit: which subscores produced a real value for THIS site
  // vs. which fell back to the neutral 5.0 default. A subscore is "present" only
  // if it could be meaningfully computed — meaning the underlying data was uploaded
  // AND the site has the structure (informational pages / programs) for the score
  // function to operate on. A site with Semrush data but zero informational posts
  // gets backlinkDistribution: false (N/A) because the score function returns its
  // fallback when called on an empty informational array.
  const signalsPresent: SubscorePresence = {
    contentVolume: true,
    topicalConcentration: informational.length > 0,
    organicFootprint: informational.some((r) => r.gscImpressions != null),
    internalLinkGap: informational.some((r) => r.inlinks != null),
    programPageClarity: programs.length > 0,
    backlinkDistribution: informational.some((r) => r.referringDomains != null),
  };
  const presentCount = Object.values(signalsPresent).filter(Boolean).length;
  const dataCompleteness = presentCount / 6;

  // Substitute neutral 5.0 where signal is absent (so a single missing signal
  // doesn't tank the composite). The presence map is exposed so the UI can
  // surface N/A on absent subscores instead of showing the placeholder value.
  for (const k of Object.keys(signalsPresent) as Array<keyof SubscorePresence>) {
    if (!signalsPresent[k]) subs[k] = 5;
  }

  const w = cfg.subscoreWeights;
  const composite =
    subs.contentVolume * w.contentVolume +
    subs.topicalConcentration * w.topicalConcentration +
    subs.organicFootprint * w.organicFootprint +
    subs.internalLinkGap * w.internalLinkGap +
    subs.programPageClarity * w.programPageClarity +
    subs.backlinkDistribution * w.backlinkDistribution;

  // Viability gate: cap the score when the site lacks pillar prerequisites.
  // "Site has nothing to pillar around" should produce a low score even if
  // the composite math props it up via neutral defaults for missing signals.
  const anchorCount = programs.length + locations.length;

  let viabilityCap = 10;
  if (informational.length === 0 && anchorCount === 0) {
    // No content AND no anchors — nothing to cluster, nothing to anchor under.
    viabilityCap = 1;
  } else if (informational.length === 0) {
    // Anchors exist but no content to cluster under them.
    viabilityCap = 2;
  }

  const score = Math.max(1, Math.min(viabilityCap, Math.round(composite)));

  return { score, subscores: subs, subscorePresence: signalsPresent, subscoreContext, dataCompleteness };
}

function contentVolumeScore(n: number): number {
  if (n < 15) return 0;
  if (n >= 100) return 10;
  return ((n - 15) / 85) * 10;
}

function topicalConcentrationScore(records: UrlRecord[], cfg: PillarConfig): number {
  if (records.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    counts.set(r.topicClusterId, (counts.get(r.topicClusterId) ?? 0) + 1);
  }
  const validClusters = Array.from(counts.values()).filter((c) => c >= cfg.minClusterSize).length;
  if (validClusters === 0) return 0;
  if (validClusters >= 5 && validClusters <= 8) return 10;
  if (validClusters < 5) return (validClusters / 5) * 10;
  if (validClusters >= 14) return 5;
  return 10 - ((validClusters - 8) / 6) * 5;
}

function organicFootprintScore(records: UrlRecord[]): number {
  const hasData = records.some((r) => r.gscImpressions != null);
  if (!hasData) return 5;
  const totalImpressions = records.reduce((acc, r) => acc + (r.gscImpressions ?? 0), 0);
  return Math.max(0, Math.min(10, Math.log10(totalImpressions + 1) * 2));
}

function internalLinkGapScore(records: UrlRecord[]): number {
  if (records.length === 0) return 0;
  const avgInlinks = records.reduce((a, r) => a + (r.inlinks ?? 0), 0) / records.length;
  return Math.max(0, Math.min(10, 10 - avgInlinks));
}

function programPageClarityScore(programs: UrlRecord[]): number {
  if (programs.length === 0) return 0;
  const trans = programs.filter((p) => p.intentClass === 'transactional');
  if (trans.length === 0) return 2;
  const avgConf = trans.reduce((a, p) => a + p.intentConfidence, 0) / trans.length;
  return Math.round(avgConf * 10);
}

function backlinkDistributionScore(records: UrlRecord[]): number {
  const withRD = records.filter((r) => r.referringDomains != null);
  if (withRD.length === 0) return 5;
  const values = withRD.map((r) => r.referringDomains!);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(10, cv * 5));
}
