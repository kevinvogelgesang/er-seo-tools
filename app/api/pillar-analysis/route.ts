// app/api/pillar-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runPillarAnalysisFromInputs } from '@/lib/services/pillarAnalysis.service';
import { InternalParser } from '@/lib/parsers/internal.parser';
import { gscMapFromParser, ga4MapFromParser, semrushMapFromParser } from '@/lib/services/pillarAnalysis/extractors';
import { getUploadDir } from '@/lib/upload-helpers';
import Papa from 'papaparse';

export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }
  if (session.status !== 'complete') {
    return NextResponse.json({ error: 'session_not_complete', status: session.status }, { status: 409 });
  }

  // Create the PillarAnalysis record in 'running' state
  const pa = await prisma.pillarAnalysis.create({
    data: { sessionId: body.sessionId, status: 'running' },
  });

  const internalCsvPath = await locateInternalCsv(session.id, JSON.parse(session.files || '[]'));
  if (!internalCsvPath) {
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: 'internal_all.csv not found in session uploads' },
    });
    return NextResponse.json({ error: 'internal_all_missing' }, { status: 422 });
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
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
        dataCompleteness: result.dataCompleteness,
        hubRecommendation: JSON.stringify(result.hubRecommendation),
        pillarTopics: JSON.stringify(result.pillarTopics),
        urlVerdicts: JSON.stringify(result.urlVerdicts),
      },
    });

    return NextResponse.json({ id: pa.id, status: 'complete' });
  } catch (err: any) {
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: err.message?.slice(0, 500) ?? 'unknown' },
    });
    return NextResponse.json({ error: 'analysis_failed', message: err.message }, { status: 500 });
  } finally {
    // Clean up the session upload directory now that we've consumed it.
    // The parse route used to do this but we moved it here so the files survive
    // long enough for pillar analysis to read them.
    try {
      const fs = await import('fs/promises');
      const uploadDir = getUploadDir(body.sessionId);
      await fs.rm(uploadDir, { recursive: true, force: true });
    } catch { /* best-effort cleanup */ }
  }
}

async function locateInternalCsv(sessionId: string, files: string[]): Promise<string | null> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const uploadDir = getUploadDir(sessionId);
  for (const f of files) {
    if (!/internal_all/i.test(f)) continue;
    const full = path.join(uploadDir, f);
    try {
      await fs.access(full);
      return full;
    } catch { /* keep looking */ }
  }
  return null;
}

async function loadGscMap(dir: string) {
  const fs = await import('fs/promises');
  const path = await import('path');
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => /search_console|gsc/i.test(f) && f.endsWith('.csv'));
  } catch { return new Map(); }
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseSearchConsoleCsv(csv);
  return gscMapFromParser(rows);
}

async function loadGa4Map(dir: string) {
  const fs = await import('fs/promises');
  const path = await import('path');
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => /analytics|ga4/i.test(f) && f.endsWith('.csv'));
  } catch { return new Map(); }
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseGa4Csv(csv);
  return ga4MapFromParser(rows);
}

async function loadSemrushMap(dir: string) {
  const fs = await import('fs/promises');
  const path = await import('path');
  let candidates: string[];
  try {
    candidates = (await fs.readdir(dir)).filter((f) => /semrush/i.test(f) && f.endsWith('.csv'));
  } catch { return new Map(); }
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
