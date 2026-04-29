import { describe, it, expect } from 'vitest';
import {
  contentVolumeLabel,
  topicalConcentrationLabel,
  organicFootprintLabel,
  internalLinkGapLabel,
  programPageClarityLabel,
  backlinkDistributionLabel,
  type SubscoreContext,
} from './subscoreLabels';

const baseCtx: SubscoreContext = {
  informationalCount: 50,
  programCount: 3,
  locationCount: 2,
  validClusterCount: 6,
};

describe('subscoreLabels', () => {
  describe('contentVolumeLabel', () => {
    it('zero informational pages → "No informational content"', () => {
      expect(contentVolumeLabel(0, { ...baseCtx, informationalCount: 0 })).toBe('No informational content');
    });
    it('value 0 with informational count > 0 → "Below content floor"', () => {
      expect(contentVolumeLabel(0, { ...baseCtx, informationalCount: 10 })).toMatch(/Below content floor/);
    });
    it('value 3 → "Thin content base"', () => {
      expect(contentVolumeLabel(3, baseCtx)).toBe('Thin content base');
    });
    it('value 5 → "Modest content depth"', () => {
      expect(contentVolumeLabel(5, baseCtx)).toBe('Modest content depth');
    });
    it('value 8 → "Strong content depth"', () => {
      expect(contentVolumeLabel(8, baseCtx)).toBe('Strong content depth');
    });
  });

  describe('topicalConcentrationLabel', () => {
    it('0 valid clusters → "No coherent clusters formed"', () => {
      expect(topicalConcentrationLabel(0, { ...baseCtx, validClusterCount: 0 })).toBe('No coherent clusters formed');
    });
    it('1 cluster → singular form', () => {
      expect(topicalConcentrationLabel(2, { ...baseCtx, validClusterCount: 1 })).toBe('1 cluster (narrow range)');
    });
    it('3 clusters → plural narrow', () => {
      expect(topicalConcentrationLabel(6, { ...baseCtx, validClusterCount: 3 })).toBe('3 clusters (narrow range)');
    });
    it('6 clusters → ideal', () => {
      expect(topicalConcentrationLabel(10, { ...baseCtx, validClusterCount: 6 })).toBe('6 clusters (ideal spread)');
    });
    it('10 clusters → slightly broad', () => {
      expect(topicalConcentrationLabel(8, { ...baseCtx, validClusterCount: 10 })).toBe('10 clusters (slightly broad)');
    });
    it('15 clusters → over-fragmented', () => {
      expect(topicalConcentrationLabel(5, { ...baseCtx, validClusterCount: 15 })).toBe('Over-fragmented (15+ clusters)');
    });
  });

  describe('organicFootprintLabel', () => {
    it('0 → "No detectable GSC presence"', () => {
      expect(organicFootprintLabel(0, baseCtx)).toBe('No detectable GSC presence');
    });
    it('2 → minimal', () => {
      expect(organicFootprintLabel(2, baseCtx)).toBe('Minimal latent demand');
    });
    it('5 → moderate', () => {
      expect(organicFootprintLabel(5, baseCtx)).toBe('Moderate search visibility');
    });
    it('9 → strong', () => {
      expect(organicFootprintLabel(9, baseCtx)).toBe('Strong latent demand to harvest');
    });
  });

  describe('internalLinkGapLabel', () => {
    it('0 → already well-linked', () => {
      expect(internalLinkGapLabel(0, baseCtx)).toBe('Already well-linked (low pillar leverage)');
    });
    it('3 → modestly linked', () => {
      expect(internalLinkGapLabel(3, baseCtx)).toBe('Modestly linked (some leverage)');
    });
    it('5 → some leverage', () => {
      expect(internalLinkGapLabel(5, baseCtx)).toBe('Some pillar leverage');
    });
    it('8 → sparse linking', () => {
      expect(internalLinkGapLabel(8, baseCtx)).toBe('Sparse internal linking (high pillar leverage)');
    });
  });

  describe('programPageClarityLabel', () => {
    it('zero programs → "No program pages detected"', () => {
      expect(programPageClarityLabel(0, { ...baseCtx, programCount: 0 })).toBe('No program pages detected');
    });
    it('value 2 with programs → ambiguous', () => {
      expect(programPageClarityLabel(2, baseCtx)).toBe('Program intent ambiguous');
    });
    it('value 5 → partially clear', () => {
      expect(programPageClarityLabel(5, baseCtx)).toBe('Program intent partially clear');
    });
    it('value 9 → strongly classified', () => {
      expect(programPageClarityLabel(9, baseCtx)).toBe('Program anchors strongly classified');
    });
  });

  describe('backlinkDistributionLabel', () => {
    it('0 → evenly distributed', () => {
      expect(backlinkDistributionLabel(0, baseCtx)).toBe('Backlinks evenly distributed (or absent)');
    });
    it('2 → spread', () => {
      expect(backlinkDistributionLabel(2, baseCtx)).toBe('Backlinks evenly spread');
    });
    it('5 → moderate variance', () => {
      expect(backlinkDistributionLabel(5, baseCtx)).toBe('Moderate backlink variance');
    });
    it('9 → concentrated', () => {
      expect(backlinkDistributionLabel(9, baseCtx)).toBe('Concentrated backlinks (consolidation opportunity)');
    });
  });
});
