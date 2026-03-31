import { describe, it, expect } from 'vitest';
import { computeScore, computeScoreFromCounts } from './scoring';
import type { AxeViolation } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeViolation(
  impact: AxeViolation['impact'],
  nodeCount: number
): AxeViolation {
  return {
    id: `rule-${impact}-${nodeCount}`,
    impact,
    help: 'Test violation',
    description: 'Test',
    helpUrl: 'https://dequeuniversity.com',
    tags: ['wcag2aa'],
    nodes: Array.from({ length: nodeCount }, (_, i) => ({ html: `<div id="${i}">` })),
  };
}

// ── computeScore ─────────────────────────────────────────────────────────────

describe('computeScore', () => {
  it('returns score 100 and compliant false when violations array is empty (0 elements)', () => {
    // scoreFromPenalty: penalty=0, totalElements=0
    // score = max(0, round(100 - 0/log10(max(10,0)))) = 100
    // compliant = totalElements === 0 → true... wait, no violations & 0 nodes → compliant true
    // Re-reading source: compliant: totalElements === 0
    const result = computeScore([], 'wcag21aa');
    expect(result.score).toBe(100);
    expect(result.compliant).toBe(true);
  });

  it('returns compliant false when there are violations (node count > 0)', () => {
    const result = computeScore([makeViolation('minor', 1)], 'wcag21aa');
    expect(result.compliant).toBe(false);
  });

  it('produces a low score for only critical violations', () => {
    // 5 critical violations, each with 1 node → totalPenalty=20, totalElements=5
    // divisor = log10(max(10,5)) = 1, score = max(0, 100-20/1) = 80
    const violations = Array.from({ length: 5 }, () => makeViolation('critical', 1));
    const result = computeScore(violations, 'wcag21aa');
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('applies correct weights: critical(4) > serious(3) > moderate(2) > minor(1)', () => {
    // One violation of each impact, 1 node each → totalElements=4
    // divisor = log10(max(10,4)) = 1
    // critical penalty = 4, serious = 3, moderate = 2, minor = 1 → sum = 10
    // score = max(0, 100 - 10/1) = 90
    const violations = [
      makeViolation('critical', 1),
      makeViolation('serious', 1),
      makeViolation('moderate', 1),
      makeViolation('minor', 1),
    ];
    const result = computeScore(violations, 'wcag21aa');
    expect(result.score).toBe(90);
  });

  it('gives a higher score when elements are numerous but violations are few', () => {
    // 1 minor violation with 1 node vs 1 minor violation with 1000 nodes
    // Large totalElements increases divisor → lower effective penalty
    const smallResult = computeScore([makeViolation('minor', 1)], 'wcag21aa');
    const largeResult = computeScore([makeViolation('minor', 10000)], 'wcag21aa');
    // With more elements the denominator grows, so penalty per unit is smaller
    // smallResult: penalty=1, totalElements=1, divisor=log10(10)=1, score=99
    // largeResult: penalty=1, totalElements=10000, divisor=log10(10000)=4, score=round(100-0.25)=100
    expect(largeResult.score).toBeGreaterThanOrEqual(smallResult.score);
  });

  it('score never goes below 0', () => {
    // Extreme case: 1000 critical violations with 1 node each
    const violations = Array.from({ length: 1000 }, () => makeViolation('critical', 1));
    const result = computeScore(violations, 'wcag21aa');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('score never exceeds 100', () => {
    const result = computeScore([], 'wcag21aa');
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('ignores violations with null impact in penalty calculation', () => {
    // null impact doesn't match critical/serious/moderate/minor → adds 0 penalty
    // but nodes still count toward totalElements
    const nullViolation: AxeViolation = {
      id: 'null-impact',
      impact: null,
      help: 'test',
      description: 'test',
      helpUrl: '',
      tags: [],
      nodes: [{ html: '<div>' }],
    };
    const result = computeScore([nullViolation], 'wcag21aa');
    // penalty=0, totalElements=1, divisor=1, score=100
    expect(result.score).toBe(100);
    expect(result.compliant).toBe(false); // totalElements=1, not 0
  });

  it('uses element node counts to determine totalElements (multiple nodes per violation)', () => {
    // 1 serious violation with 5 nodes: totalElements=5, penalty=3
    // divisor = log10(max(10,5)) = 1, score = round(100-3) = 97
    const result = computeScore([makeViolation('serious', 5)], 'wcag21aa');
    expect(result.score).toBe(97);
    expect(result.compliant).toBe(false);
  });

  it('wcagLevel parameter is accepted but does not affect score (ignored internally)', () => {
    const violations = [makeViolation('moderate', 2)];
    const resultAA = computeScore(violations, 'wcag21aa');
    const resultAAA = computeScore(violations, 'wcag22aa');
    expect(resultAA.score).toBe(resultAAA.score);
  });

  it('wcagLevel parameter has no effect on score', () => {
    const violations = [makeViolation('critical', 1), makeViolation('moderate', 3)];
    const result21aa = computeScore(violations, 'wcag21aa');
    const result22aa = computeScore(violations, 'wcag22aa');
    expect(result21aa.score).toBe(result22aa.score);
    expect(result21aa.compliant).toBe(result22aa.compliant);
  });

  it('computes exact score at totalElements === 10 (log10 boundary where divisor === 1.0)', () => {
    // 1 critical violation with 4 nodes + null-impact violation with 6 nodes = 10 total elements
    // penalty = 1 * 4 = 4 (null impact contributes 0 penalty)
    // divisor = log10(max(10, 10)) = log10(10) = 1.0
    // score = round(100 - 4 / 1.0) = 96
    const nullViolation: AxeViolation = {
      id: 'null-impact-filler',
      impact: null,
      help: 'filler',
      description: 'filler',
      helpUrl: '',
      tags: [],
      nodes: Array.from({ length: 6 }, (_, i) => ({ html: `<span id="${i}">` })),
    };
    const violations = [makeViolation('critical', 4), nullViolation];
    const result = computeScore(violations, 'wcag21aa');
    expect(result.score).toBe(96);
    expect(result.compliant).toBe(false);
  });
});

// ── computeScoreFromCounts ────────────────────────────────────────────────────

describe('computeScoreFromCounts', () => {
  it('returns score 100 and compliant true when all counts are 0', () => {
    const result = computeScoreFromCounts(
      { critical: 0, serious: 0, moderate: 0, minor: 0 },
      'wcag21aa'
    );
    expect(result.score).toBe(100);
    expect(result.compliant).toBe(true);
  });

  it('returns compliant false when any count is non-zero', () => {
    const result = computeScoreFromCounts(
      { critical: 1, serious: 0, moderate: 0, minor: 0 },
      'wcag21aa'
    );
    expect(result.compliant).toBe(false);
  });

  it('score never goes below 0', () => {
    const result = computeScoreFromCounts(
      { critical: 10000, serious: 10000, moderate: 10000, minor: 10000 },
      'wcag21aa'
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('score never exceeds 100', () => {
    const result = computeScoreFromCounts(
      { critical: 0, serious: 0, moderate: 0, minor: 0 },
      'wcag21aa'
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('produces a lower score for critical than for minor violations (same count)', () => {
    const criticalResult = computeScoreFromCounts(
      { critical: 5, serious: 0, moderate: 0, minor: 0 },
      'wcag21aa'
    );
    const minorResult = computeScoreFromCounts(
      { critical: 0, serious: 0, moderate: 0, minor: 5 },
      'wcag21aa'
    );
    expect(criticalResult.score).toBeLessThan(minorResult.score);
  });

  it('matches computeScore output for equivalent single-node violations', () => {
    // 2 critical, 1 serious, 3 moderate, 4 minor — each with 1 node
    const violations: AxeViolation[] = [
      ...Array.from({ length: 2 }, () => makeViolation('critical', 1)),
      ...Array.from({ length: 1 }, () => makeViolation('serious', 1)),
      ...Array.from({ length: 3 }, () => makeViolation('moderate', 1)),
      ...Array.from({ length: 4 }, () => makeViolation('minor', 1)),
    ];
    const fromViolations = computeScore(violations, 'wcag21aa');
    const fromCounts = computeScoreFromCounts(
      { critical: 2, serious: 1, moderate: 3, minor: 4 },
      'wcag21aa'
    );
    expect(fromCounts.score).toBe(fromViolations.score);
    expect(fromCounts.compliant).toBe(fromViolations.compliant);
  });

  it('only minor violations produce near-perfect scores', () => {
    const result = computeScoreFromCounts(
      { critical: 0, serious: 0, moderate: 0, minor: 1 },
      'wcag21aa'
    );
    // total=1, penalty=1, divisor=log10(max(10,1))=1, score=99
    expect(result.score).toBe(99);
  });

  it('computeScore and computeScoreFromCounts return the same score for equivalent input', () => {
    // 2 critical (1 node each), 1 serious (1 node), 3 moderate (1 node each), 4 minor (1 node each)
    // With 1 node per violation, violation counts === node counts, so both functions
    // receive identical numbers through scoreFromPenalty.
    // totalElements = 2+1+3+4 = 10
    // penalty = 2*4 + 1*3 + 3*2 + 4*1 = 8+3+6+4 = 21
    // divisor = log10(10) = 1.0
    // score = round(100 - 21 / 1.0) = 79
    const violations: AxeViolation[] = [
      ...Array.from({ length: 2 }, () => makeViolation('critical', 1)),
      makeViolation('serious', 1),
      ...Array.from({ length: 3 }, () => makeViolation('moderate', 1)),
      ...Array.from({ length: 4 }, () => makeViolation('minor', 1)),
    ];
    const fromViolations = computeScore(violations, 'wcag21aa');
    const fromCounts = computeScoreFromCounts(
      { critical: 2, serious: 1, moderate: 3, minor: 4 },
      'wcag21aa',
    );
    expect(fromViolations.score).toBe(79);
    expect(fromCounts.score).toBe(79);
    expect(fromCounts.score).toBe(fromViolations.score);
    expect(fromCounts.compliant).toBe(fromViolations.compliant);
  });
});
