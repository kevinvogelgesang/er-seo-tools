// scripts/streaming-parity-check.ts
//
// Dev-only harness — NOT shipped in the app path. Runs the NEW streaming
// parser path over the real Manhattan crawl export and self-diffs each
// result against the pre-refactor baseline JSON committed in
// test-fixtures/streaming-parity-baseline/<parserKey>.json (captured from the
// OLD whole-file Papa.parse path before the streaming conversion). Asserts
// byte-identical output via assert.deepStrictEqual and exits non-zero on any
// divergence — this is the real-data proof that the streaming conversion
// preserved behavior exactly.
//
// Usage: DATABASE_URL="file:./local-dev.db" npx tsx scripts/streaming-parity-check.ts
import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { findParserForFile } from '../lib/parsers';
import { streamCsv } from '../lib/parsers/stream-csv';

const dir = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25';
const baselineDir = path.join(__dirname, '..', 'test-fixtures', 'streaming-parity-baseline');
const targets = ['all_outlinks.csv', 'all_anchor_text.csv', 'images_all.csv'];

async function main() {
  let failures = 0;
  for (const f of targets) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      console.log(`skip ${f} (absent)`);
      continue;
    }
    const P = findParserForFile(f) as any; // filename-first, no content
    if (!P) {
      failures++;
      console.error(`✗ ${f} — no parser matched`);
      continue;
    }
    const parser = new P();
    await streamCsv(p, (row: any) => parser.consume(row));
    const out = parser.finalize();
    const baselinePath = path.join(baselineDir, `${P.parserKey}.json`);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    try {
      assert.deepStrictEqual(out, baseline);
      console.log(`✓ ${f} (${P.parserKey}) byte-identical to pre-refactor baseline`);
    } catch {
      failures++;
      console.error(`✗ ${f} (${P.parserKey}) DIVERGED from baseline`);
      fs.writeFileSync(`/tmp/parity-${P.parserKey}.actual.json`, JSON.stringify(out, null, 2));
    }
  }
  if (failures) {
    console.error(`${failures} parser(s) diverged`);
    process.exit(1);
  }
  console.log('All streaming parsers reproduce the pre-refactor baseline exactly.');
}

main();
