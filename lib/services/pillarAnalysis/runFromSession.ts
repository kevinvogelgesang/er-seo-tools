import { promises as fs } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { prisma } from '@/lib/db';
import { InternalParser } from '@/lib/parsers/internal.parser';
import { getUploadDir } from '@/lib/upload-helpers';
import { runPillarAnalysisFromInputs } from '@/lib/services/pillarAnalysis.service';
import {
  ga4MapFromParser,
  gscMapFromParser,
  semrushMapFromParser,
} from '@/lib/services/pillarAnalysis/extractors';

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

  const pa = await prisma.pillarAnalysis.create({
    data: { sessionId, status: 'running' },
  });

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
  } finally {
    await fs.rm(getUploadDir(sessionId), { recursive: true, force: true }).catch(() => {});
  }
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
