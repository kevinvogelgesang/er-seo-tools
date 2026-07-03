import { ResourceFileParser, type ResourceFileConfig } from './resource-file.base';

export class CSSParser extends ResourceFileParser {
  static parserKey = 'css';
  static filenamePattern = ['internal_css', 'css'];

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_css_files',
    large: { threshold: 100 * 1024, type: 'large_css_files', severity: 'notice', statKey: 'large_css_files', description: (n) => `${n} large CSS files (> 100KB)` },
    broken: { type: 'broken_css', severity: 'warning', statKey: 'broken_css', description: (n) => `${n} broken CSS files` },
  };
}
