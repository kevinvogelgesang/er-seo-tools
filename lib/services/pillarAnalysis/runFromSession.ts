import { promises as fs } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { InternalParser } from '@/lib/parsers/internal.parser';
import { getUploadDir } from '@/lib/upload-helpers';
import { runPillarAnalysisFromInputs } from '@/lib/services/pillarAnalysis.service';
import {
  ga4MapFromParser,
  gscMapFromParser,
  semrushMapFromParser,
} from '@/lib/services/pillarAnalysis/extractors';
import type { RawUrlData } from '@/lib/services/pillarAnalysis/joinRecords';
import { getCanonicalPageFacts } from '@/lib/services/canonical-page-facts';
import { selectCanonicalSeoRun } from '@/lib/services/seo-canonical';
import { publishInvalidation } from '@/lib/events/bus';
import { pillarAnalysisTopic } from '@/lib/events/topics';

export class PillarAnalysisRunError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PillarAnalysisRunError';
  }
}

export async function runPillarAnalysisForSession(sessionId: string): Promise<{ id: string; status: 'complete' }> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new PillarAnalysisRunError('session_not_found', 'Session not found', 404);
  }
  if (session.status !== 'complete') {
    throw new PillarAnalysisRunError('session_not_complete', 'Session is not complete', 409, {
      status: session.status,
    });
  }

  // Enforce one PillarAnalysis row per session. If one already exists:
  //   complete → return it (idempotent)
  //   running  → 409 already_running
  //   error    → reset to running and re-run on the same row
  // If none exists, create a new row. A defensive P2002 catch handles the race
  // where two concurrent callers slip past the findFirst check.
  const pa = await acquirePillarAnalysisRow(sessionId);
  if (pa.alreadyComplete) {
    return { id: pa.id, status: 'complete' };
  }
  // A5 Task 24: PillarAnalysisButtonClient subscribes to
  // pillarAnalysisTopic(sessionId) — the same sessionId this function is
  // always called with (the session path never needs a row lookup for the
  // topic id). `alreadyComplete === false` here means acquirePillarAnalysisRow
  // just wrote a real state change (created a new running row, or reset an
  // existing pending/error row to running) — the 'already_running' 409 case
  // always throws before reaching here, so no spurious emit on that path.
  publishInvalidation(pillarAnalysisTopic(sessionId));

  let files: string[];
  try {
    const parsed = JSON.parse(session.files || '[]');
    files = Array.isArray(parsed) ? parsed.filter((file): file is string => typeof file === 'string') : [];
  } catch {
    files = [];
  }

  const internalCsvPath = await locateInternalCsv(session.id, files);
  if (!internalCsvPath) {
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: 'internal_all.csv not found in session uploads' },
    });
    publishInvalidation(pillarAnalysisTopic(sessionId));
    throw new PillarAnalysisRunError('internal_all_missing', 'internal_all.csv not found in session uploads', 422);
  }

  try {
    const csv = await fs.readFile(internalCsvPath, 'utf-8');
    const internalRows = new InternalParser(csv).parsePerUrlForPillar();

    const uploadDir = path.dirname(internalCsvPath);
    const gsc = await loadGscMap(uploadDir);
    const ga4 = await loadGa4Map(uploadDir);
    const semrush = await loadSemrushMap(uploadDir);

    const result = await runPillarAnalysisFromInputs({ internalRows, gsc, ga4, semrush });

    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: {
        status: 'complete',
        error: null,
        score: result.score,
        subscores: JSON.stringify(result.subscores),
        subscorePresence: JSON.stringify(result.subscorePresence),
        subscoreContext: JSON.stringify(result.subscoreContext),
        dataCompleteness: result.dataCompleteness,
        hubRecommendation: JSON.stringify(result.hubRecommendation),
        pillarTopics: JSON.stringify(result.pillarTopics),
        urlVerdicts: JSON.stringify(result.urlVerdicts),
      },
    });
    publishInvalidation(pillarAnalysisTopic(sessionId));

    // Only clean up upload dir on the success path. On failure we leave the
    // raw CSVs in place so the user can retry without re-uploading.
    await fs.rm(getUploadDir(sessionId), { recursive: true, force: true }).catch(() => {});

    return { id: pa.id, status: 'complete' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: message.slice(0, 500) },
    });
    publishInvalidation(pillarAnalysisTopic(sessionId));
    throw new PillarAnalysisRunError('analysis_failed', message, 500);
  }
}

/**
 * Get-or-create the single PillarAnalysis row for a session, with status
 * branching for re-runs and a defensive P2002 race fallback.
 */
async function acquirePillarAnalysisRow(
  sessionId: string,
): Promise<{ id: string; alreadyComplete: boolean }> {
  const existing = await prisma.pillarAnalysis.findFirst({ where: { sessionId } });
  if (existing) {
    return reconcileExisting(existing);
  }

  try {
    const created = await prisma.pillarAnalysis.create({
      data: { sessionId, status: 'running' },
    });
    return { id: created.id, alreadyComplete: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Race: another caller inserted between findFirst and create.
      const racedRow = await prisma.pillarAnalysis.findFirst({ where: { sessionId } });
      if (racedRow) {
        return reconcileExisting(racedRow);
      }
    }
    throw err;
  }
}

async function reconcileExisting(
  row: { id: string; status: string },
): Promise<{ id: string; alreadyComplete: boolean }> {
  if (row.status === 'complete') {
    return { id: row.id, alreadyComplete: true };
  }
  if (row.status === 'running') {
    throw new PillarAnalysisRunError(
      'already_running',
      'A pillar analysis is already running for this session',
      409,
      { id: row.id },
    );
  }
  // pending | error → reset to running and continue with this row
  await prisma.pillarAnalysis.update({
    where: { id: row.id },
    data: { status: 'running', error: null },
  });
  return { id: row.id, alreadyComplete: false };
}

async function locateInternalCsv(sessionId: string, files: string[]): Promise<string | null> {
  const uploadDir = getUploadDir(sessionId);
  for (const file of files) {
    if (!/internal_all/i.test(file)) continue;
    const full = path.join(uploadDir, file);
    try {
      await fs.access(full);
      return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function loadGscMap(dir: string) {
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => /search_console|gsc/i.test(f) && f.endsWith('.csv'));
  } catch {
    return new Map();
  }
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseSearchConsoleCsv(csv);
  return gscMapFromParser(rows);
}

async function loadGa4Map(dir: string) {
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => /analytics|ga4/i.test(f) && f.endsWith('.csv'));
  } catch {
    return new Map();
  }
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseGa4Csv(csv);
  return ga4MapFromParser(rows);
}

async function loadSemrushMap(dir: string) {
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => {
      if (!f.endsWith('.csv')) return false;
      return /semrush/i.test(f)
        || /-organic\.(positions|pages)-/i.test(f)
        || /^position_tracking/i.test(f);
    });
  } catch {
    return new Map();
  }
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseSemrushCsv(csv);
  return semrushMapFromParser(rows);
}

function parseSearchConsoleCsv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['Address'] || row['URL'] || '',
    clicks: Number(row['Clicks'] || row['GSC Clicks'] || 0),
    impressions: Number(row['Impressions'] || row['GSC Impressions'] || 0),
    ctr: Number(row['CTR'] || row['GSC CTR'] || 0),
    position: Number(row['Position'] || row['GSC Position'] || 0),
  }));
}

function parseGa4Csv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['Address'] || row['URL'] || '',
    sessions: Number(row['GA4 Sessions'] || row['Sessions'] || 0),
    engagementRate: parseRate(row['GA4 Engagement rate'] || row['Engagement rate']),
    keyEvents: Number(row['GA4 Key events'] || row['Key events'] || 0),
  }));
}

function parseSemrushCsv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['URL'] || row['Address'] || '',
    referringDomains: Number(row['Referring Domains'] || row['Domains'] || 0),
    organicKeywords: Number(row['Organic Keywords'] || row['Keywords'] || 0),
  }));
}

function parseRate(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace('%', '').trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return 0;
  return cleaned.includes('%') || n > 1 ? n / 100 : n;
}

// =============================================================================
// Live-scan (canonical) path
// =============================================================================

/**
 * Run a pillar analysis from the canonical SEO run for a given client+domain
 * (Task 11 / D3). Does NOT require an SF upload or Session. Persists a
 * PillarAnalysis row keyed by `crawlRunId` (sessionId null). Idempotent.
 */
export async function runForCanonical({
  clientId,
  domain,
}: {
  clientId: number;
  domain: string;
}): Promise<{ id: string; status: 'complete' }> {
  // 1. Load canonical page facts from the live-scan or SF run.
  const facts = await getCanonicalPageFacts({ clientId, domain });
  if (!facts || facts.pages.length === 0) {
    throw new PillarAnalysisRunError(
      'no_canonical_facts',
      'No canonical page facts found for this client/domain',
      422,
    );
  }

  // 2. Map CanonicalPageFact[] → RawUrlData[] for the pure pipeline.
  const internalRows: RawUrlData[] = facts.pages.map((p) => ({
    url: p.url,
    title: p.title ?? null,
    h1: p.h1 ?? null,
    metaDescription: p.metaDescription ?? null,
    firstParagraph: null,         // not available from live-scan
    wordCount: p.wordCount ?? null,
    crawlDepth: p.crawlDepth ?? null,
    inlinks: p.inlinks ?? null,
    outlinks: p.outlinks ?? null,
    indexable: p.indexable ?? true, // default true when unknown
    schemaTypes: p.schemaTypes ?? [], // not available from live-scan
  }));

  // 3. Resolve the crawlRunId from the canonical run (may be null if facts
  //    came from a session-only source path — getCanonicalPageFacts returns
  //    CrawlPage rows which always have a runId).
  const canonical = await selectCanonicalSeoRun({ clientId, domain });
  const crawlRunId = canonical?.run.id ?? null;

  // 4. Acquire or create a PillarAnalysis row keyed by crawlRunId.
  const pa = await acquirePillarAnalysisRowForRun(crawlRunId, clientId, domain);
  if (pa.alreadyComplete) {
    return { id: pa.id, status: 'complete' };
  }

  try {
    const result = await runPillarAnalysisFromInputs({
      internalRows,
      gsc: new Map(),
      ga4: new Map(),
      semrush: new Map(),
    });

    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: {
        status: 'complete',
        error: null,
        score: result.score,
        subscores: JSON.stringify(result.subscores),
        subscorePresence: JSON.stringify(result.subscorePresence),
        subscoreContext: JSON.stringify(result.subscoreContext),
        dataCompleteness: result.dataCompleteness,
        hubRecommendation: JSON.stringify(result.hubRecommendation),
        pillarTopics: JSON.stringify(result.pillarTopics),
        urlVerdicts: JSON.stringify(result.urlVerdicts),
      },
    });

    return { id: pa.id, status: 'complete' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: message.slice(0, 500) },
    });
    throw new PillarAnalysisRunError('analysis_failed', message, 500);
  }
}

/**
 * Get-or-create the single PillarAnalysis row for a live/canonical run,
 * with status branching and a defensive P2002 race fallback.
 */
async function acquirePillarAnalysisRowForRun(
  crawlRunId: string | null,
  clientId: number,
  domain: string,
): Promise<{ id: string; alreadyComplete: boolean }> {
  const existing = crawlRunId
    ? await prisma.pillarAnalysis.findFirst({ where: { crawlRunId } })
    : await prisma.pillarAnalysis.findFirst({ where: { clientId, domain, sessionId: null } });

  if (existing) return reconcileExisting(existing);

  try {
    const created = await prisma.pillarAnalysis.create({
      data: { crawlRunId, clientId, domain, sessionId: null, status: 'running' },
    });
    return { id: created.id, alreadyComplete: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Race: another caller inserted between findFirst and create.
      const racedRow = crawlRunId
        ? await prisma.pillarAnalysis.findFirst({ where: { crawlRunId } })
        : await prisma.pillarAnalysis.findFirst({ where: { clientId, domain, sessionId: null } });
      if (racedRow) return reconcileExisting(racedRow);
    }
    throw err;
  }
}
