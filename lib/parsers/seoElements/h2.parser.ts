import { LengthValidatorParser, type LengthValidatorConfig } from './length-validator.base';

export class H2Parser extends LengthValidatorParser {
  static parserKey = 'h2';
  static filenamePattern = ['h2_all', 'h2'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['H2-1', 'H2'],
    missing: { type: 'missing_h2', severity: 'notice', label: 'H2 headings' },
    // missing-only
  };
}
