import { describe, it, expect } from 'vitest';
import { composePayload, parsePillarPrompt } from './pillar-prompt';

describe('pillar-prompt round-trip', () => {
  it('parsePillarPrompt extracts all three fields from composePayload output', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_eyJhbGciOiJIUzI1NiJ9.payload.sig',
    });
    const parsed = parsePillarPrompt(out);
    expect(parsed).not.toBeNull();
    expect(parsed!.webappUrl).toBe('https://seo-tools.er.com');
    expect(parsed!.analysisId).toBe('pa_abc123');
    expect(parsed!.token).toBe('pat_eyJhbGciOiJIUzI1NiJ9.payload.sig');
  });

  it('parsePillarPrompt returns null when token missing', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_x',
    }).replace(/^Access token:.*$/m, '');
    expect(parsePillarPrompt(out)).toBeNull();
  });

  it('parsePillarPrompt returns null when token lacks pat_ prefix', () => {
    const text = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_x',
    }).replace('pat_x', 'invalidtoken');
    expect(parsePillarPrompt(text)).toBeNull();
  });

  it('parsePillarPrompt is whitespace-tolerant on field separators', () => {
    // Some clipboard managers may add CRLF or tab variations
    const text = [
      'Run a pillar analysis narrative on this site.',
      '',
      'Webapp:  https://seo-tools.er.com',  // double space
      '\tAnalysis ID:\tpa_abc123',           // tab indented + tab separator
      'Access token:   pat_xyz',             // multiple spaces
      '(Expires in 1h)',
    ].join('\r\n');
    const parsed = parsePillarPrompt(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.webappUrl).toBe('https://seo-tools.er.com');
    expect(parsed!.analysisId).toBe('pa_abc123');
    expect(parsed!.token).toBe('pat_xyz');
  });

  it('composePayload output preserves the documented format', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc',
      token: 'pat_xyz',
    });
    expect(out).toContain('Run a pillar analysis narrative on this site.');
    expect(out).toContain('Webapp: https://seo-tools.er.com');
    expect(out).toContain('Analysis ID: pa_abc');
    expect(out).toContain('Access token: pat_xyz');
    expect(out).toContain('(Expires in 1h)');
    expect(out).toContain('Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.');
  });
});
