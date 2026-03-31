import { describe, it, expect } from 'vitest';
import { SpellingGrammarParser, GrammarParser } from './spellingGrammar.parser';

describe('SpellingGrammarParser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "spelling"', () => {
      expect(SpellingGrammarParser.filenamePattern).toBe('spelling');
    });

    it('matchesFile returns true for filenames containing "spelling"', () => {
      expect(SpellingGrammarParser.matchesFile('spelling.csv')).toBe(true);
      expect(SpellingGrammarParser.matchesFile('spelling_grammar.csv')).toBe(true);
      expect(SpellingGrammarParser.matchesFile('SPELLING.CSV')).toBe(true);
    });

    it('matchesFile returns false for unrelated filenames', () => {
      expect(SpellingGrammarParser.matchesFile('grammar.csv')).toBe(false);
      expect(SpellingGrammarParser.matchesFile('images.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new SpellingGrammarParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for headers-only CSV', () => {
      const csv = `Address,Spelling Errors,Grammar Errors`;
      const parser = new SpellingGrammarParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('spelling errors', () => {
    it('detects spelling errors and creates issue', () => {
      const csv = `Address,Spelling Errors
https://example.com/page1,3
https://example.com/page2,5
https://example.com/page3,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'spelling_errors');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(8);
    });

    it('records total_spelling_errors and pages_with_spelling_errors stats', () => {
      const csv = `Address,Spelling Errors
https://example.com/page1,3
https://example.com/page2,5
https://example.com/page3,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      expect(result.stats.total_spelling_errors).toBe(8);
      expect(result.stats.pages_with_spelling_errors).toBe(2);
    });

    it('does not push spelling_errors issue when all error counts are 0', () => {
      const csv = `Address,Spelling Errors
https://example.com/page1,0
https://example.com/page2,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'spelling_errors');
      expect(issue).toBeUndefined();
      expect(result.stats).toBeUndefined();
    });

    it('skips spelling check when Spelling Errors column is absent', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,2`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'spelling_errors');
      expect(issue).toBeUndefined();
      expect(result.stats?.total_spelling_errors).toBeUndefined();
    });
  });

  describe('grammar errors', () => {
    it('detects grammar errors and creates issue', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,2
https://example.com/page2,4`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'grammar_errors');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(6);
    });

    it('records total_grammar_errors and pages_with_grammar_errors stats', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,2
https://example.com/page2,0
https://example.com/page3,1`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      expect(result.stats.total_grammar_errors).toBe(3);
      expect(result.stats.pages_with_grammar_errors).toBe(2);
    });

    it('does not push grammar_errors issue when all error counts are 0', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'grammar_errors');
      expect(issue).toBeUndefined();
    });

    it('skips grammar check when Grammar Errors column is absent', () => {
      const csv = `Address,Spelling Errors
https://example.com/page1,3`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'grammar_errors');
      expect(issue).toBeUndefined();
    });
  });

  describe('combined spelling and grammar', () => {
    it('detects both spelling and grammar errors when both columns present', () => {
      const csv = `Address,Spelling Errors,Grammar Errors
https://example.com/page1,3,2
https://example.com/page2,0,1
https://example.com/page3,5,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      expect(result.issues).toHaveLength(2);
      expect(result.stats.total_spelling_errors).toBe(8);
      expect(result.stats.pages_with_spelling_errors).toBe(2);
      expect(result.stats.total_grammar_errors).toBe(3);
      expect(result.stats.pages_with_grammar_errors).toBe(2);
    });

    it('returns no issues when both error counts are all zero', () => {
      const csv = `Address,Spelling Errors,Grammar Errors
https://example.com/page1,0,0
https://example.com/page2,0,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      expect(result.issues).toHaveLength(0);
      expect(result.stats).toBeUndefined();
    });
  });

  describe('total_pages', () => {
    it('reports correct total_pages count', () => {
      const csv = `Address,Spelling Errors
https://example.com/page1,0
https://example.com/page2,2
https://example.com/page3,1`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(3);
    });
  });

  describe('issue description format', () => {
    it('includes error counts and page counts in description', () => {
      const csv = `Address,Spelling Errors,Grammar Errors
https://example.com/page1,3,2
https://example.com/page2,5,0`;

      const parser = new SpellingGrammarParser(csv);
      const result = parser.parse();

      const spellingIssue = result.issues.find((i: { type: string }) => i.type === 'spelling_errors');
      expect(spellingIssue.description).toContain('8');
      expect(spellingIssue.description).toContain('2');

      const grammarIssue = result.issues.find((i: { type: string }) => i.type === 'grammar_errors');
      expect(grammarIssue.description).toContain('2');
      expect(grammarIssue.description).toContain('1');
    });
  });
});

describe('GrammarParser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "grammar"', () => {
      expect(GrammarParser.filenamePattern).toBe('grammar');
    });

    it('matchesFile returns true for filenames containing "grammar"', () => {
      expect(GrammarParser.matchesFile('grammar.csv')).toBe(true);
      expect(GrammarParser.matchesFile('grammar_report.csv')).toBe(true);
      expect(GrammarParser.matchesFile('GRAMMAR.CSV')).toBe(true);
    });

    it('matchesFile returns false for spelling-only filenames', () => {
      expect(GrammarParser.matchesFile('spelling.csv')).toBe(false);
    });
  });

  describe('parse behavior (inherits from SpellingGrammarParser)', () => {
    it('detects grammar errors', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,4
https://example.com/page2,0`;

      const parser = new GrammarParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'grammar_errors');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(4);
    });

    it('naturally skips spelling check when Spelling column is absent', () => {
      const csv = `Address,Grammar Errors
https://example.com/page1,4`;

      const parser = new GrammarParser(csv);
      const result = parser.parse();

      const spellingIssue = result.issues.find((i: { type: string }) => i.type === 'spelling_errors');
      expect(spellingIssue).toBeUndefined();
    });

    it('returns empty object for empty CSV', () => {
      const parser = new GrammarParser('');
      expect(parser.parse()).toEqual({});
    });
  });
});
