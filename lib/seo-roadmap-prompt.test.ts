import { describe, it, expect } from 'vitest';
import { composeRoadmapPayload } from './seo-roadmap-prompt';

describe('composeRoadmapPayload', () => {
  it('includes webapp, roadmap id, token, and the srt_ line', () => {
    const out = composeRoadmapPayload({ webappUrl: 'https://app.example', roadmapId: 'rm_1', token: 'srt_abc' });
    expect(out).toContain('Webapp: https://app.example');
    expect(out).toContain('Roadmap ID: rm_1');
    expect(out).toContain('Access token: srt_abc');
  });
});
