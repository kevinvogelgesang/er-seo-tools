import fs from 'fs';

const DEFAULT_BASE_CHARS = 64 * 1024;
const DEFAULT_MAX_CHARS = 1024 * 1024;

/**
 * Read a bounded top-of-file prefix sufficient for content-based parser
 * detection: at least `baseChars`, extended until the first newline (so the
 * full header line is present), hard-capped at `maxChars`. Used only when
 * filename detection misses. Stream is decoded utf8, so the accumulator is
 * measured in characters, not bytes (immaterial for a detection peek).
 */
export function readHeaderChunk(
  filePath: string,
  opts: { baseChars?: number; maxChars?: number } = {}
): Promise<string> {
  const baseChars = opts.baseChars ?? DEFAULT_BASE_CHARS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  return new Promise<string>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    let buf = '';
    const done = () => { stream.destroy(); resolve(buf.slice(0, maxChars)); };
    stream.on('data', (chunk: string | Buffer) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const hasNewline = buf.indexOf('\n') !== -1;
      if ((buf.length >= baseChars && hasNewline) || buf.length >= maxChars) done();
    });
    stream.on('end', () => resolve(buf.slice(0, maxChars)));
    stream.on('error', reject);
  });
}
