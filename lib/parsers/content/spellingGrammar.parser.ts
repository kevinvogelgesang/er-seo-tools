import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class SpellingGrammarParser extends BaseParser {
  static parserKey = 'spellinggrammar';
  // Match both spelling and grammar files
  static filenamePattern = 'spelling';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL', 'Page URL']);
    const spellingCol = this.findColumn(['Spelling Errors', 'Spelling']);
    const grammarCol = this.findColumn(['Grammar Errors', 'Grammar']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    let totalSpellingErrors = 0;
    let totalGrammarErrors = 0;
    let pagesWithSpelling = 0;
    let pagesWithGrammar = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (spellingCol) {
        const errors = toNumber(this.data[i][spellingCol]);
        if (errors !== null && errors > 0) {
          totalSpellingErrors += errors;
          pagesWithSpelling++;
        }
      }
      if (grammarCol) {
        const errors = toNumber(this.data[i][grammarCol]);
        if (errors !== null && errors > 0) {
          totalGrammarErrors += errors;
          pagesWithGrammar++;
        }
      }
    }

    if (totalSpellingErrors > 0) {
      stats.total_spelling_errors = totalSpellingErrors;
      stats.pages_with_spelling_errors = pagesWithSpelling;

      issues.push({
        type: 'spelling_errors',
        severity: 'notice',
        count: totalSpellingErrors,
        description: `${totalSpellingErrors} spelling errors across ${pagesWithSpelling} pages`,
      });
    }

    if (totalGrammarErrors > 0) {
      stats.total_grammar_errors = totalGrammarErrors;
      stats.pages_with_grammar_errors = pagesWithGrammar;

      issues.push({
        type: 'grammar_errors',
        severity: 'notice',
        count: totalGrammarErrors,
        description: `${totalGrammarErrors} grammar errors across ${pagesWithGrammar} pages`,
      });
    }

    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}

export class GrammarParser extends SpellingGrammarParser {
  static parserKey = 'grammar';
  // Match grammar files specifically (no spelling column in these files,
  // so SpellingGrammarParser.parse() will naturally skip the spelling checks)
  static filenamePattern = 'grammar';
}
