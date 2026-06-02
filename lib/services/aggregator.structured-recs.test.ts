import { describe, it, expect } from 'vitest';
import { AggregatorService } from './aggregator.service';

describe('aggregator structured_recommendations wiring', () => {
  it('emits a non-empty structured_recommendations array with required fields', () => {
    const agg = new AggregatorService();

    // Supply a page with a null title so deriveIssueTypesForPage flags missing_title.
    // Also supply seo_elements_summary so buildIssues() emits a missing_title Issue,
    // giving us a real entry in structured_recommendations.
    agg.addParserResult('internal', {
      per_url_index: [
        {
          url: 'https://example.edu/no-title',
          title: null,
          h1: 'Some H1',
          metaDescription: null,
          wordCount: 400,
          crawlDepth: 1,
          indexable: true,
        },
      ],
      seo_elements_summary: {
        missing_titles_count: 1,
        missing_titles_urls: ['https://example.edu/no-title'],
      },
    }, 'internal_all.csv');

    const result = agg.aggregate();

    // Outer contract: field is defined and non-empty
    expect(result.structured_recommendations).toBeDefined();
    expect(Array.isArray(result.structured_recommendations)).toBe(true);
    expect(result.structured_recommendations!.length).toBeGreaterThan(0);

    // Every entry must have the core fields the builder guarantees
    for (const rec of result.structured_recommendations!) {
      expect(rec).toHaveProperty('issueType');
      expect(rec).toHaveProperty('effort');
      expect(rec).toHaveProperty('affectedSetHash');
      expect(typeof rec.affectedSetHash).toBe('string');
      expect(rec.affectedSetHash.length).toBeGreaterThan(0);
    }

    // Stronger assertion: a missing_title entry exists with correct counts
    const missingTitleRec = result.structured_recommendations!.find(
      (r) => r.issueType === 'missing_title',
    );
    expect(missingTitleRec).toBeDefined();
    expect(missingTitleRec!.affectedUrlCount).toBeGreaterThanOrEqual(1);
    expect(missingTitleRec!.severity).toBe('critical');
  });
});
