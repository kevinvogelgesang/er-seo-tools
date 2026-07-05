import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFindUniqueMock = vi.fn();
const sessionUpdateManyMock = vi.fn();
const sessionUpdateMock = vi.fn().mockResolvedValue({});
const clientFindManyMock = vi.fn().mockResolvedValue([]);
const sessionPageDeleteManyMock = vi.fn().mockResolvedValue({});
const txMock = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...a: unknown[]) => sessionFindUniqueMock(...a),
      updateMany: (...a: unknown[]) => sessionUpdateManyMock(...a),
      update: (...a: unknown[]) => sessionUpdateMock(...a),
    },
    client: { findMany: (...a: unknown[]) => clientFindManyMock(...a) },
    sessionPage: { deleteMany: (...a: unknown[]) => sessionPageDeleteManyMock(...a) },
    $transaction: (...a: unknown[]) => txMock(...a),
  },
}));

// Keep the heavy parse pipeline + pillar trigger out of the gate test.
// NOTE: route.ts imports the trigger from '../pillar-analysis-trigger' (parent
// dir), so the mock path MUST match exactly or it won't intercept.
// aggregatorCalls records the ORDER addParserResult() is invoked (i.e. the
// ingestion order the route feeds the aggregator), so ordering tests can
// assert it stays manifest-order even when the underlying parses complete
// out of order under concurrency.
const { aggregatorCalls } = vi.hoisted(() => ({ aggregatorCalls: [] as string[] }));
vi.mock('@/lib/services/aggregator.service', () => ({
  AggregatorService: class {
    addParserResult(_name: string, _data: unknown, filename: string) {
      aggregatorCalls.push(filename);
    }
    aggregate() {
      return {
        crawl_summary: {}, issues: { critical: [], warnings: [], notices: [] },
        site_structure: {}, resources: {}, technical_seo: {}, performance: {},
        recommendations: [],
        metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
      };
    }
  },
}));
// Named handle (not an inline vi.fn()) so file_reports' beforeEach can
// re-arm mockResolvedValue: the gate describe's afterEach calls
// vi.restoreAllMocks(), which strips mockResolvedValue off any vi.fn()
// defined inline in a factory — leaving a bare vi.fn() that returns
// undefined, so `.catch` below would throw and 500 the success path.
const triggerPillarAnalysisMock = vi.fn();
vi.mock('../pillar-analysis-trigger', () => ({
  triggerPillarAnalysis: (...a: unknown[]) => triggerPillarAnalysisMock(...a),
}));
vi.mock('@/lib/services/session-page-builder', () => ({
  buildSessionPages: () => ({
    scalars: { siteHost: null, totalUrls: 0, criticalCount: 0, warningCount: 0, noticeCount: 0 },
  }),
}));
vi.mock('@/lib/findings/seo-write', () => ({ writeSeoFindings: vi.fn().mockResolvedValue(undefined) }));

// Control parser resolution per-filename: throwing parser => failed; good => parsed; null => unmatched.
const findParserForFileMock = vi.fn();
vi.mock('@/lib/parsers', () => ({
  findParserForFile: (...a: unknown[]) => findParserForFileMock(...a),
}));

import fs from 'fs/promises';
import path from 'path';
import { getUploadDir } from '@/lib/upload-helpers';
import { PARSE_CONCURRENCY } from '@/lib/parsers/parse-limit';
import { POST } from './route';
import type { CSVRow } from '@/lib/types';

const VALID_ID = '64c1a005-40e9-40d8-a62c-e4226cc78c0b';
const ctx = { params: Promise.resolve({ sessionId: VALID_ID }) };

describe('POST /api/parse/[sessionId] — core-export gate', () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockReset();
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a technical session missing core exports without claiming it', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'technical',
      files: JSON.stringify(['images_missing_alt_text.csv']),
    });

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain('internal');
    expect(body.missingCore).toContain('internal_all');
    expect(sessionUpdateManyMock).not.toHaveBeenCalled(); // not claimed
  });

  it('does NOT reject a keyword-research session on the core gate; it claims and proceeds', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'keyword-research',
      files: JSON.stringify(['semrush_organic_positions.csv']),
    });

    let body: { missingCore?: unknown } = {};
    const res = await POST({} as never, ctx as never);
    try { body = await res.json(); } catch { /* downstream may not return JSON */ }

    expect(body.missingCore).toBeUndefined(); // not the core-gate rejection
    expect(sessionUpdateManyMock).toHaveBeenCalled(); // got past the gate to the claim
  });

  it('does NOT return a core-missing 400 for a corrupt file manifest (gate skipped, claim proceeds)', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'technical',
      files: 'not-valid-json{',
    });

    let body: { missingCore?: unknown } = {};
    const res = await POST({} as never, ctx as never);
    try { body = await res.json(); } catch { /* downstream may not return JSON */ }

    // The corrupt manifest must NOT be reported as missing-core; the gate is
    // skipped and the session is claimed (the downstream corrupt-manifest path
    // handles the real error).
    expect(body.missingCore).toBeUndefined();
    expect(sessionUpdateManyMock).toHaveBeenCalled();
  });
});

function goodParser(key: string) {
  return class {
    static parserKey = key;
    constructor(_c: string) {}
    parse() { return {}; }
    getPrimaryDomain() { return 'example.com'; }
  };
}
function goodParserWithDomain(key: string, domain: string) {
  return class {
    static parserKey = key;
    constructor(_content: string) {}
    parse() { return { ok: true }; }
    getPrimaryDomain() { return domain; }
  };
}
function throwingParser(key: string) {
  return class {
    static parserKey = key;
    constructor(_c: string) {}
    parse(): Record<string, unknown> { throw new Error('boom'); }
    getPrimaryDomain() { return null; }
  };
}

describe('POST /api/parse/[sessionId] — file_reports', () => {
  const dir = getUploadDir(VALID_ID);
  const manifest = [
    'internal_all.csv',                              // parsed (core) — passes gate
    'response_codes.csv',                            // parsed — passes gate
    'page_titles.csv',                               // failed (normal)
    'response_codes_internal_redirect_chain.csv',    // failed (normal — over-inclusion guard)
    'badfile.csv',                                   // unmatched
    'notes.txt',                                     // skipped
  ];

  beforeEach(async () => {
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'technical', files: JSON.stringify(manifest),
    });
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    sessionUpdateMock.mockReset().mockResolvedValue({});
    clientFindManyMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
    triggerPillarAnalysisMock.mockReset().mockResolvedValue(undefined);
    findParserForFileMock.mockReset().mockImplementation((filename: string) => {
      if (filename === 'internal_all.csv') return throwingParser('internal');   // core FAIL
      if (filename === 'response_codes.csv') return goodParser('responsecodes'); // parsed
      if (filename === 'page_titles.csv') return throwingParser('pagetitles');   // normal FAIL
      if (filename === 'response_codes_internal_redirect_chain.csv') return throwingParser('responsecodes');
      return null; // badfile.csv -> unmatched
    });
    await fs.mkdir(dir, { recursive: true });
    for (const f of manifest) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('emits one FileReport per manifest file with correct status + severity', async () => {
    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    const reports = body.result.metadata.file_reports as Array<{ filename: string; status: string; severity: string }>;
    const by = Object.fromEntries(reports.map(r => [r.filename, r]));

    expect(reports).toHaveLength(6);
    expect(by['response_codes.csv'].status).toBe('parsed');
    expect(by['internal_all.csv']).toMatchObject({ status: 'failed', severity: 'core' });
    expect(by['page_titles.csv']).toMatchObject({ status: 'failed', severity: 'normal' });
    expect(by['response_codes_internal_redirect_chain.csv']).toMatchObject({ status: 'failed', severity: 'normal' });
    expect(by['badfile.csv'].status).toBe('unmatched');
    expect(by['notes.txt'].status).toBe('skipped');
  });

  it('no longer writes result.parsing_errors and preserves parsers_used for parsed files', async () => {
    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(body.result.parsing_errors).toBeUndefined();
    expect(body.result.metadata.parsers_used).toContain('responsecodes');
    expect(body.result.metadata.parsers_used).not.toContain('pagetitles'); // it threw
  });
});

// Two-path parseOne (Task 6): filename-first detection with a header-peek
// fallback, then a streaming branch (consume/finalize) vs the unchanged
// whole-file branch (constructor(content)/parse()). These all exercise the
// MOCKED findParserForFile (findParserForFileMock), never the real registry
// — that coverage lives in lib/parsers/detection-equivalence.test.ts.
describe('POST /api/parse/[sessionId] — two-path parseOne', () => {
  const dir = getUploadDir(VALID_ID);

  function fakeStreamingParser(key: string, finalizeResult: Record<string, unknown>, rowsSeen: unknown[]) {
    return class {
      static parserKey = key;
      static streaming = true;
      consume(row: CSVRow) { rowsSeen.push(row); }
      finalize() { return finalizeResult; }
      getPrimaryDomain() { return 'stream.example.com'; }
    };
  }

  beforeEach(async () => {
    // workflow: 'keyword-research' skips the core-export gate entirely, so
    // these tests can focus purely on parseOne's branching.
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    sessionUpdateMock.mockReset().mockResolvedValue({});
    clientFindManyMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
    triggerPillarAnalysisMock.mockReset().mockResolvedValue(undefined);
    await fs.mkdir(dir, { recursive: true });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('streaming path: drives a streaming-flagged parser via consume/finalize, not a whole-file read', async () => {
    const rowsSeen: unknown[] = [];
    const finalizeResult = { streamed: true, rowCount: 2 };
    const StreamingClass = fakeStreamingParser('fakestreaming', finalizeResult, rowsSeen);

    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(['streaming.csv']),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      filename === 'streaming.csv' ? StreamingClass : null
    );
    await fs.writeFile(
      path.join(dir, 'streaming.csv'),
      'Address,Title\nhttps://example.com/,Hi\nhttps://example.com/2,Yo\n'
    );

    const readFileSpy = vi.spyOn(fs, 'readFile');

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    const reports = body.result.metadata.file_reports as Array<{ filename: string; status: string }>;
    expect(reports.find((r) => r.filename === 'streaming.csv')).toMatchObject({ status: 'parsed' });
    // The streaming branch must never whole-file `fs.readFile` the CSV.
    expect(readFileSpy).not.toHaveBeenCalledWith(path.join(dir, 'streaming.csv'), 'utf-8');
    // Driven row-by-row via consume(), and the aggregator got finalize()'s result.
    expect(rowsSeen).toHaveLength(2);
  });

  it('unmatched: filename miss + content-peek miss never triggers a whole-file read', async () => {
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(['nomatch.csv']),
    });
    findParserForFileMock.mockReset().mockImplementation(() => null);
    await fs.writeFile(path.join(dir, 'nomatch.csv'), 'Foo,Bar\n1,2\n');

    const readFileSpy = vi.spyOn(fs, 'readFile');

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    const reports = body.result.metadata.file_reports as Array<{ filename: string; status: string }>;
    expect(reports.find((r) => r.filename === 'nomatch.csv')).toMatchObject({ status: 'unmatched' });
    // findParserForFile is consulted filename-first, then with the bounded peek —
    // never with a full fs.readFile of the CSV.
    expect(findParserForFileMock).toHaveBeenCalledWith('nomatch.csv');
    expect(readFileSpy).not.toHaveBeenCalledWith(path.join(dir, 'nomatch.csv'), 'utf-8');
  });

  it('whole-file path unchanged: a non-streaming match still routes through constructor(content)/parse()', async () => {
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(['wholefile.csv']),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      filename === 'wholefile.csv' ? goodParser('wholefile') : null
    );
    await fs.writeFile(path.join(dir, 'wholefile.csv'), 'Address\nhttps://example.com/\n');

    const readFileSpy = vi.spyOn(fs, 'readFile');

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    const reports = body.result.metadata.file_reports as Array<{ filename: string; status: string }>;
    expect(reports.find((r) => r.filename === 'wholefile.csv')).toMatchObject({ status: 'parsed' });
    expect(readFileSpy).toHaveBeenCalledWith(path.join(dir, 'wholefile.csv'), 'utf-8');
  });
});

describe('POST /api/parse/[sessionId] — concurrent parse ordering', () => {
  const dir = getUploadDir(VALID_ID);

  beforeEach(async () => {
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    sessionUpdateMock.mockReset().mockResolvedValue({});
    clientFindManyMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
    triggerPillarAnalysisMock.mockReset().mockResolvedValue(undefined);
    aggregatorCalls.length = 0;
    await fs.mkdir(dir, { recursive: true });
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('ingests into the aggregator in sessionFiles order even when parses finish out of order', async () => {
    const files = ['a.csv', 'b.csv', 'c.csv'];
    // Delay reads so the FIRST file resolves LAST → completion order reverses.
    const delayByFile: Record<string, number> = { 'a.csv': 40, 'b.csv': 20, 'c.csv': 5 };
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    // Every file is a whole-file (non-streaming) match → route calls fs.readFile.
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      files.includes(filename) ? goodParser(filename.replace('.csv', '')) : null
    );
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      const base = path.basename(String(p));
      if (base in delayByFile) await new Promise((r) => setTimeout(r, delayByFile[base]));
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    expect(res.status).toBe(200);
    // Ingestion order is manifest order, NOT completion order (c,b,a).
    expect(aggregatorCalls).toEqual(['a.csv', 'b.csv', 'c.csv']);
    const body = await res.json();
    const reports = body.result.metadata.file_reports as Array<{ filename: string }>;
    expect(reports.map((r) => r.filename)).toEqual(['a.csv', 'b.csv', 'c.csv']);
  });

  it('resolves the domain tie-break to the manifest-order winner under out-of-order completion', async () => {
    // Two files, equal primary-domain count (1 each) for DIFFERENT domains;
    // the manifest-first file's domain must win (stable sort + ordered successes).
    const files = ['first.csv', 'second.csv'];
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) => {
      if (filename === 'first.csv') return goodParserWithDomain('first', 'first.example.com');
      if (filename === 'second.csv') return goodParserWithDomain('second', 'second.example.com');
      return null;
    });
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    // second.csv resolves first, first.csv resolves last.
    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      if (path.basename(String(p)) === 'first.csv') await new Promise((r) => setTimeout(r, 30));
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.metadata.site_name).toBe('first.example.com');
  });

  it('runs at most PARSE_CONCURRENCY parses at once', async () => {
    const files = ['p1.csv', 'p2.csv', 'p3.csv', 'p4.csv', 'p5.csv'];
    sessionFindUniqueMock.mockReset().mockResolvedValue({
      id: VALID_ID, status: 'pending', workflow: 'keyword-research', files: JSON.stringify(files),
    });
    findParserForFileMock.mockReset().mockImplementation((filename: string) =>
      files.includes(filename) ? goodParser(filename.replace('.csv', '')) : null
    );
    for (const f of files) await fs.writeFile(path.join(dir, f), 'Address\nhttps://example.com/\n');

    let current = 0; let peak = 0;
    const realReadFile = fs.readFile;
    const delayedRead = async (p: unknown, options: unknown): Promise<string | Buffer> => {
      current++; peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 15));
      current--;
      return (realReadFile as (a: unknown, b: unknown) => Promise<string | Buffer>)(p, options);
    };
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead as unknown as typeof fs.readFile);

    const res = await POST({} as never, ctx as never);
    expect(res.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(PARSE_CONCURRENCY);
    // env-tunable: only assert real parallelism when the cap allows it.
    if (PARSE_CONCURRENCY > 1) expect(peak).toBeGreaterThan(1);
  });
});
