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

describe('findParserForFile — redirect data routes through ResponseCodesParser', () => {
  it('routes the SF redirect-chain export to responsecodes', () => {
    expect(findParserForFile('response_codes_internal_redirect_chain.csv')?.parserKey).toBe('responsecodes');
  });
  it('routes the SF 3xx redirection export to responsecodes', () => {
    expect(findParserForFile('response_codes_redirection_(3xx).csv')?.parserKey).toBe('responsecodes');
  });
});
