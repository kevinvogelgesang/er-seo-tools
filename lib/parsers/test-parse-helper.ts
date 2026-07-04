import Papa from 'papaparse';
import type { CSVRow } from '../types';

const PAPA_CONFIG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

type WholeFile = new (content: string) => { parse(): Record<string, unknown> };
type Streaming = new () => { consume(row: CSVRow): void; finalize(): Record<string, unknown> };

/** Parse a CSV string through whichever interface the parser exposes. */
export function parseString(
  ParserClass: (WholeFile | Streaming) & { streaming?: boolean },
  csv: string
): Record<string, unknown> {
  if (ParserClass.streaming) {
    const parser = new (ParserClass as Streaming)();
    const rows = Papa.parse<CSVRow>(csv, PAPA_CONFIG).data;
    for (const row of rows) parser.consume(row);
    return parser.finalize();
  }
  return new (ParserClass as WholeFile)(csv).parse();
}
