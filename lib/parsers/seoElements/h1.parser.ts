import { LengthValidatorParser, type LengthValidatorConfig } from './length-validator.base';

export class H1Parser extends LengthValidatorParser {
  static parserKey = 'h1';
  static filenamePattern = ['h1_all', 'h1'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['H1-1', 'H1'],
    missing: { type: 'missing_h1', severity: 'warning', label: 'H1 headings' },
    // no length check
    duplicate: { type: 'duplicate_h1', severity: 'notice', label: 'H1 headings', groupValueKey: 'h1', groupValueSlice: 100 },
    multiple: { column: ['H1-2'], type: 'multiple_h1', severity: 'warning', label: 'H1 headings' },
  };
}
