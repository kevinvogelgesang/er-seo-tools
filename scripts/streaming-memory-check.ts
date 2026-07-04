// scripts/streaming-memory-check.ts
//
// Dev-only harness — NOT shipped in the app path. Builds a large (~500MB)
// synthetic all_outlinks.csv by replicating the real Manhattan crawl export,
// then runs one of two modes:
//
//   stream — the converted ExternalLinksParser via streamCsv (row-at-a-time,
//            no full-file string, no full-row-array retention). Expected to
//            complete with bounded RSS even under a constrained V8 heap.
//   whole  — raw Papa.parse(fs.readFileSync(big), CFG): the OLD whole-file
//            profile (full file string + full parsed row array in memory at
//            once). Expected to OOM under the same constrained heap. If it
//            unexpectedly completes, the file wasn't large enough to produce
//            an unambiguous contrast — this fails loudly (exit 2) rather than
//            silently reporting a false "pass".
//
// Heap sizing note (verified 2026-07-03 on this machine/Node version): 512MB
// is too tight even for the legitimate streaming path — a single-pass,
// synchronous 1.7M-row scan generates enough short-lived Papa row-object
// garbage that V8's old-space GC pacing can't keep up at a 512MB cap, so
// `stream` false-OOMs too and the contrast is meaningless. 1024MB gives
// `stream` comfortable headroom (observed peak RSS well under the cap) while
// `whole` (full string + full retained row array simultaneously) still OOMs
// reliably — use --max-old-space-size=1024 for an unambiguous contrast.
//
// Cleanup note: on a genuine OOM crash (`whole` mode, expected outcome), the
// process is killed by V8 before `fs.rmSync` at the bottom of this file can
// run, so the ~500MB temp file is left in os.tmpdir(). Check for and remove
// `big_outlinks.csv` there after running `whole`.
//
// Usage:
//   NODE_OPTIONS='--max-old-space-size=1024' DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-memory-check.ts stream
//   NODE_OPTIONS='--max-old-space-size=1024' DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-memory-check.ts whole; echo "whole exit: $?"
import fs from 'fs';
import os from 'os';
import path from 'path';
import Papa from 'papaparse';
import { ExternalLinksParser } from '../lib/parsers/resources/links.parser';
import { streamCsv } from '../lib/parsers/stream-csv';

const CFG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;
const src = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25/all_outlinks.csv';
const big = path.join(os.tmpdir(), 'big_outlinks.csv');
const TARGET = Number(process.env.MEMCHECK_TARGET_MB || 500) * 1024 * 1024;

// Builds the big file by repeating the real Manhattan body lines until TARGET
// bytes are written. Deliberately respects writable-stream backpressure
// (waits for 'drain' when write() returns false) — a naive synchronous write
// loop never yields to the event loop, so Node queues the ENTIRE ~500MB of
// pending string data in the stream's internal buffer before any of it
// reaches disk, which OOMs the *builder* itself under a constrained heap
// regardless of which mode is under test. That would invalidate the harness
// (the crash would prove nothing about the parser).
function buildBigFile(): Promise<void> {
  return new Promise((resolve, reject) => {
    const lines = fs.readFileSync(src, 'utf-8').split('\n');
    const header = lines[0];
    const body = lines.slice(1).filter(Boolean);
    const ws = fs.createWriteStream(big);
    ws.on('error', reject);

    let written = 0;
    let bodyIdx = 0;
    let wroteHeader = false;

    function writeMore() {
      let ok = true;
      while (written < TARGET && ok) {
        if (!wroteHeader) {
          wroteHeader = true;
          ok = ws.write(header + '\n');
          written += header.length + 1;
          continue;
        }
        const l = body[bodyIdx % body.length];
        bodyIdx++;
        ok = ws.write(l + '\n');
        written += l.length + 1;
      }
      if (written >= TARGET) {
        ws.end(() => resolve());
      } else {
        ws.once('drain', writeMore);
      }
    }
    writeMore();
  });
}

async function run() {
  await buildBigFile();
  const mode = process.argv[2] || 'stream';
  const before = process.memoryUsage().rss;
  if (mode === 'whole') {
    // OLD profile: full string + full row array. Expected to OOM at a tight heap.
    const content = fs.readFileSync(big, 'utf-8');
    Papa.parse(content, CFG);
    console.error(
      'UNEXPECTED: whole-file parse COMPLETED under the constrained heap — baseline invalid, raise the file size / lower the heap.'
    );
    fs.rmSync(big, { force: true });
    process.exit(2);
  } else {
    const p = new ExternalLinksParser();
    await streamCsv(big, (r: any) => p.consume(r));
    p.finalize();
  }
  const after = process.memoryUsage().rss;
  console.log(mode, 'peak RSS MB:', Math.round(after / 1048576), 'delta MB:', Math.round((after - before) / 1048576));
  fs.rmSync(big, { force: true });
}

run();
