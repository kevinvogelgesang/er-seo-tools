import { describe, it, expect } from 'vitest';
import { findParserForFile } from './index';

describe('findParserForFile — security vs insecure-content routing', () => {
  it('routes a *_insecure.csv file to InsecureContentParser, not SecurityParser', () => {
    const parser = findParserForFile('security_form_url_insecure.csv');
    expect(parser?.parserKey).toBe('insecurecontent');
  });

  it('routes a security headers export to SecurityParser', () => {
    const parser = findParserForFile('security_all.csv');
    expect(parser?.parserKey).toBe('security');
  });
});
