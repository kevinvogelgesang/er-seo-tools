import { ResourceFileParser, type ResourceFileConfig } from './resource-file.base';

export class JavaScriptParser extends ResourceFileParser {
  static parserKey = 'javascript';
  static filenamePattern = ['javascript_all', 'javascript'];

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_js_files',
    large: { threshold: 100 * 1024, type: 'large_js_files', severity: 'warning', statKey: 'large_js_files', description: (n) => `${n} large JavaScript files (> 100KB)` },
    broken: { type: 'broken_js', severity: 'critical', statKey: 'broken_js', description: (n) => `${n} broken JavaScript files` },
  };
}
