import { describe, it, expect } from 'vitest';
import { runPillarAnalysisFromInputs } from './pillarAnalysis.service';
import type { RawUrlData } from './pillarAnalysis/joinRecords';

describe('runPillarAnalysisFromInputs', () => {
  it('produces score, anchor-based pillar topics, and per-URL verdicts end-to-end', async () => {
    const internalRows: RawUrlData[] = [
      // Program anchor
      { url: 'https://e.edu/programs/nursing', title: 'Nursing Program', h1: 'Bachelor of Science in Nursing', metaDescription: null, firstParagraph: 'Our BSN program prepares you for a nursing career.', wordCount: 800, crawlDepth: 1, inlinks: 25, outlinks: 12, indexable: true, schemaTypes: ['EducationalOccupationalProgram'] },
      // Blogs that should cluster under nursing
      { url: 'https://e.edu/blog/become-rn', title: 'How to Become an RN', h1: 'Become an RN', metaDescription: 'Guide to nursing.', firstParagraph: 'Becoming a registered nurse takes study and licensure in nursing.', wordCount: 1500, crawlDepth: 3, inlinks: 8, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/rn-salary', title: 'RN Salary Guide', h1: 'Nursing Salary', metaDescription: 'How much RNs earn.', firstParagraph: 'Registered nurses earn varying amounts in nursing roles.', wordCount: 1100, crawlDepth: 3, inlinks: 4, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/nursing-school-tips', title: 'Nursing School Tips', h1: 'Tips for Nursing Students', metaDescription: 'Survive nursing school.', firstParagraph: 'Nursing school is demanding for nursing students.', wordCount: 900, crawlDepth: 3, inlinks: 2, outlinks: 5, indexable: true, schemaTypes: [] },
      // Unrelated (catchall)
      { url: 'https://e.edu/blog/cooking', title: 'Cooking with Friends', h1: 'Cook Together', metaDescription: 'Fun cooking.', firstParagraph: 'Cooking with friends builds memories.', wordCount: 400, crawlDepth: 3, inlinks: 0, outlinks: 2, indexable: true, schemaTypes: [] },
    ];
    const result = await runPillarAnalysisFromInputs({
      internalRows, gsc: new Map(), ga4: new Map(), semrush: new Map(),
      // MiniLM cosine on these short fixtures is ~0.4 for nursing-adjacent posts.
      // Lower threshold so the integration test exercises anchor assignment.
      configOverrides: { verticalAlignmentThreshold: 0.35 },
    });

    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.urlVerdicts.length).toBe(internalRows.length);

    // Find the nursing program anchor in verdicts
    const nursingProgram = result.urlVerdicts.find(r => r.url === 'https://e.edu/programs/nursing');
    expect(nursingProgram).toBeDefined();
    // The nursing blogs should be assigned to it via recommendedPillar
    const blogsUnderNursing = result.urlVerdicts.filter(
      r => r.recommendedPillar === 'https://e.edu/programs/nursing'
    );
    expect(blogsUnderNursing.length).toBeGreaterThanOrEqual(2); // at least 2 of the 3 nursing posts assigned

    // Pillar topics: at least one anchored cluster
    expect(result.pillarTopics.length).toBeGreaterThanOrEqual(1);
    // The nursing topic should have the program URL as pillar
    const nursingTopic = result.pillarTopics.find(t => t.pillarUrl === 'https://e.edu/programs/nursing');
    expect(nursingTopic).toBeDefined();
  }, 60_000);
});
