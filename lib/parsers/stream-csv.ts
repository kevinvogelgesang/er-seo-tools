import fs from 'fs';
import { Transform } from 'stream';
import Papa from 'papaparse';
import { CSVRow } from '../types';

/** Papa config MUST match BaseParser.parseCSV exactly (parity). */
export const PAPA_CONFIG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

/**
 * Strip a leading UTF-8 BOM from the first chunk only. Papa's whole-string path
 * calls stripBom(); the NODE_STREAM_INPUT path never does. This Transform closes
 * that asymmetry so streamed rows are byte-identical to the whole-file path.
 * Real Screaming Frog exports always carry a BOM on the first header column.
 */
function bomStripper(): Transform {
  let first = true;
  return new Transform({
    decodeStrings: false,
    transform(chunk: string, _enc, cb) {
      // The upstream file stream is utf8-encoded so chunks arrive as strings;
      // coerce defensively in case a Buffer ever slips through.
      const s = typeof chunk === 'string' ? chunk : String(chunk);
      if (first) {
        first = false;
        cb(null, s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
      } else {
        cb(null, s);
      }
    },
  });
}

/**
 * Stream a CSV file row-by-row into `onRow`. Resolves after the Papa stream
 * finishes; rejects (and destroys all streams) on a file-read or Papa error.
 */
export function streamCsv(filePath: string, onRow: (row: CSVRow) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const stripper = bomStripper();
    const papaStream = Papa.parse(Papa.NODE_STREAM_INPUT, PAPA_CONFIG);

    const fail = (err: unknown) => {
      fileStream.destroy();
      stripper.destroy();
      papaStream.destroy?.();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    fileStream.on('error', fail);
    stripper.on('error', fail);
    papaStream.on('error', fail);
    papaStream.on('data', (row: CSVRow) => {
      try { onRow(row); } catch (err) { fail(err); }
    });
    // Resolve ONLY on the readable-side 'end' (all parsed rows delivered).
    // NOT 'finish' — that's the writable side finishing and can fire before the
    // last 'data' events are consumed (Codex High 2).
    papaStream.on('end', () => resolve());

    fileStream.pipe(stripper).pipe(papaStream);
  });
}
