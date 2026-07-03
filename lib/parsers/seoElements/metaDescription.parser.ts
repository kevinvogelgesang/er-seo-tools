import { LengthValidatorParser, type LengthValidatorConfig } from './length-validator.base';

export class MetaDescriptionParser extends LengthValidatorParser {
  static parserKey = 'metadescription';
  static filenamePattern = ['meta_description_all', 'meta_description'];

  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['Meta Description 1', 'Meta Description'],
    missing: { type: 'missing_meta_description', severity: 'warning', label: 'meta descriptions' },
    length: {
      column: ['Meta Description 1 Length', 'Length'],
      min: 70, max: 160, noun: 'meta descriptions',
      shortType: 'meta_description_too_short', shortSeverity: 'notice',
      longType: 'meta_description_too_long', longSeverity: 'notice',
    },
    duplicate: { type: 'duplicate_meta_description', severity: 'notice', label: 'meta descriptions', groupValueKey: 'meta_description', groupValueSlice: 200 },
    // no multiple check
  };
}
