import { LengthValidatorParser, type LengthValidatorConfig } from './length-validator.base';

export class PageTitlesParser extends LengthValidatorParser {
  static parserKey = 'pagetitles';
  static filenamePattern = ['page_titles_all', 'page_titles'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['Title 1', 'Title'],
    missing: { type: 'missing_title', severity: 'critical', label: 'title tags' },
    length: {
      column: ['Title 1 Length', 'Title Length', 'Length'],
      min: 30, max: 60, noun: 'titles',
      shortType: 'title_too_short', shortSeverity: 'warning',
      longType: 'title_too_long', longSeverity: 'notice',
    },
    duplicate: { type: 'duplicate_title', severity: 'warning', label: 'titles', groupValueKey: 'title', groupValueSlice: 100 },
    multiple: { column: ['Title 2'], type: 'multiple_titles', severity: 'warning', label: 'title tags' },
  };
}
