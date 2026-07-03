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
vi.mock('@/lib/services/aggregator.service', () => ({
  AggregatorService: class {
    addParserResult() {}
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
import { POST } from './route';

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
