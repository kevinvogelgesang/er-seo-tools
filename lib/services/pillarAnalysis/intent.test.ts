import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent';

describe('classifyIntent', () => {
  it('"How to become a nurse" → informational', () => {
    const r = classifyIntent({
      title: 'How to Become a Registered Nurse',
      h1: 'How to Become an RN',
      url: 'https://example.edu/blog/how-to-become-rn',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('informational');
    expect(r.intentConfidence).toBeGreaterThan(0.7);
  });

  it('"Best nursing schools" → commercial', () => {
    const r = classifyIntent({
      title: 'Best Nursing Schools in California',
      h1: 'Top Nursing Programs',
      url: 'https://example.edu/blog/best-nursing-schools',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('commercial');
  });

  it('"Apply now" program page → transactional', () => {
    const r = classifyIntent({
      title: 'BSN Program — Apply Now',
      h1: 'Bachelor of Science in Nursing',
      url: 'https://example.edu/programs/bsn',
      pageType: 'program',
      schemaTypes: ['EducationalOccupationalProgram'],
    });
    expect(r.intentClass).toBe('transactional');
  });

  it('Default by pageType: blog → informational when no rules fire', () => {
    const r = classifyIntent({
      title: 'Nursing Stories',
      h1: 'Stories',
      url: 'https://example.edu/blog/stories',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('informational');
  });

  it('Default by pageType: nav → navigational', () => {
    const r = classifyIntent({
      title: 'About Us',
      h1: 'About',
      url: 'https://example.edu/about',
      pageType: 'nav',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('navigational');
  });

  it('Conflicting signals → lower confidence', () => {
    const r = classifyIntent({
      title: 'How to Find the Best Nursing School',
      h1: 'Finding the Best School',
      url: 'https://example.edu/blog/find-school',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentConfidence).toBeLessThan(0.7);
  });
});
