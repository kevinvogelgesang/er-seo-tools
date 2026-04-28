import { describe, it, expect } from 'vitest';
import { runPillarAnalysisFromInputs } from './pillarAnalysis.service';
import type { RawUrlData } from './pillarAnalysis/joinRecords';

describe('runPillarAnalysisFromInputs', () => {
  it('produces score, hub recommendation, and per-URL verdicts end-to-end', async () => {
    const internalRows: RawUrlData[] = [
      // 3 nursing posts that should cluster together
      { url: 'https://e.edu/blog/become-rn', title: 'How to Become an RN', h1: 'Become an RN', metaDescription: 'Guide to nursing.', firstParagraph: 'Becoming a registered nurse takes study and licensure.', wordCount: 1500, crawlDepth: 3, inlinks: 8, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/rn-salary', title: 'RN Salary Guide', h1: 'Nursing Salary', metaDescription: 'How much RNs earn.', firstParagraph: 'Registered nurses earn varying amounts by state and specialty.', wordCount: 1100, crawlDepth: 3, inlinks: 4, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/nursing-school-tips', title: 'Nursing School Tips', h1: 'Tips for Nursing Students', metaDescription: 'Survive nursing school.', firstParagraph: 'Nursing school is demanding; here are tips for studying.', wordCount: 900, crawlDepth: 3, inlinks: 2, outlinks: 5, indexable: true, schemaTypes: [] },
      // Program page
      { url: 'https://e.edu/programs/bsn', title: 'BSN Program — Apply', h1: 'Bachelor of Science in Nursing', metaDescription: null, firstParagraph: 'Our BSN program prepares you for a nursing career.', wordCount: 800, crawlDepth: 1, inlinks: 25, outlinks: 12, indexable: true, schemaTypes: ['EducationalOccupationalProgram'] },
      // Unrelated singleton
      { url: 'https://e.edu/blog/cooking', title: 'Cooking with Friends', h1: 'Cook Together', metaDescription: 'Fun group cooking.', firstParagraph: 'Cooking with friends builds memories around the table.', wordCount: 400, crawlDepth: 3, inlinks: 0, outlinks: 2, indexable: true, schemaTypes: [] },
    ];
    const result = await runPillarAnalysisFromInputs({
      internalRows,
      gsc: new Map(),
      ga4: new Map(),
      semrush: new Map(),
    });
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.urlVerdicts.length).toBe(internalRows.length);
    // The 3 nursing posts should cluster together (allow up to 2 cluster ids in case the
    // model splits a borderline case; the assertion is that we don't fragment further).
    const nursingClusterIds = result.urlVerdicts
      .filter(r => /nursing|rn|bsn/i.test(r.title || ''))
      .map(r => r.topicClusterId)
      .filter((c): c is number => c != null && c >= 0);
    expect(new Set(nursingClusterIds).size).toBeLessThanOrEqual(2);
    expect(result.hubRecommendation.primary).toBeDefined();
    expect(result.hubRecommendation.alternates.length).toBeGreaterThan(0);
  }, 60_000);
});
