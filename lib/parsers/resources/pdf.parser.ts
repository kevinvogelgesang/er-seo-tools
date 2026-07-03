import { ResourceFileParser, type ResourceFileConfig } from './resource-file.base';

export class PDFParser extends ResourceFileParser {
  static parserKey = 'pdf';
  static filenamePattern = 'pdf';

  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_pdfs',
    large: { threshold: 5 * 1024 * 1024, type: 'large_pdfs', severity: 'notice', statKey: 'large_pdfs', description: (n) => `${n} large PDFs (> 5MB)` },
    broken: { type: 'broken_pdfs', severity: 'warning', statKey: 'broken_pdfs', description: (n) => `${n} broken PDF links` },
  };
}
