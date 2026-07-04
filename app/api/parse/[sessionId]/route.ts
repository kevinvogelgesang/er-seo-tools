import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';
import { findParserForFile } from '@/lib/parsers';
import { readHeaderChunk } from '@/lib/parsers/read-header-chunk';
import { streamCsv } from '@/lib/parsers/stream-csv';
import { AggregatorService } from '@/lib/services/aggregator.service';
import { triggerPillarAnalysis } from '../pillar-analysis-trigger';
import { buildSessionPages } from '@/lib/services/session-page-builder';
import { normalizeHost } from '@/lib/services/normalize-host';
import { missingCoreExports, isCoreExport } from '@/lib/parsers/expected-exports';
import { writeSeoFindings } from '@/lib/findings/seo-write';
import { loadArchivedSeoResult } from '@/lib/findings/seo-findings-fallback';
import type { FileReport, CSVRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/parse/:sessionId
 * Run all parsers on the uploaded files for this session.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  let claimedSession = false;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'pending') {
      return NextResponse.json(
        { error: session.status === 'parsing' ? 'Parsing already in progress' : `Cannot parse a ${session.status} session` },
        { status: 409 }
      );
    }

    // Core-export gate (technical workflow only). Keyword-research/SEMRush-only
    // sessions are never gated. Runs before claiming so a rejected parse leaves
    // the session 'pending' (the user can add the missing exports and retry).
    //
    // If the manifest can't be parsed here, we SKIP the gate (do NOT report it as
    // missing-core) and let the existing file-manifest parse below raise the real
    // "Session file manifest is corrupt" error.
    if (session.workflow !== 'keyword-research') {
      let filesForGate: string[] | null = null;
      try {
        const parsed = JSON.parse(session.files);
        if (Array.isArray(parsed)) {
          filesForGate = parsed.filter((f): f is string => typeof f === 'string');
        }
      } catch {
        filesForGate = null; // corrupt → skip gate, handled downstream
      }
      if (filesForGate !== null) {
        const missing = missingCoreExports(filesForGate);
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `Missing required Screaming Frog export(s): ${missing
                .map((m) => m.label)
                .join(', ')}. ${missing.map((m) => m.sfInstructions).join(' ')}`,
              missingCore: missing.map((m) => m.id),
            },
            { status: 400 }
          );
        }
      }
    }

    const claim = await prisma.session.updateMany({
      where: {
        id: sessionId,
        status: 'pending',
      },
      data: { status: 'parsing', error: null },
    });

    if (claim.count === 0) {
      return NextResponse.json({ error: 'Parsing already in progress' }, { status: 409 });
    }
    claimedSession = true;

    const uploadDir = getUploadDir(sessionId);
    let sessionFiles: string[] = [];
    try {
      const parsed = JSON.parse(session.files);
      if (!Array.isArray(parsed)) throw new Error('files must be an array');
      sessionFiles = parsed.filter((file): file is string => typeof file === 'string');
    } catch {
      throw new Error('Session file manifest is corrupt');
    }
    if (sessionFiles.length === 0) {
      throw new Error('Session has no files to parse');
    }

    const aggregator = new AggregatorService();

    type AnyWholeFileParser = { parse(): Record<string, unknown>; getPrimaryDomain(): string | null };
    type AnyStreamingParser = {
      consume(row: CSVRow): void; finalize(): Record<string, unknown>; getPrimaryDomain(): string | null;
    };
    type ParseSuccess = { parserName: string; result: Record<string, unknown>; filename: string; primaryDomain: string | null };
    type FileOutcome = { report: FileReport; success?: ParseSuccess };

    const failed = (filename: string, error: string): FileOutcome => ({
      report: {
        filename,
        status: 'failed',
        error,
        severity: isCoreExport(filename) ? 'core' : 'normal',
      },
    });

    const parseOne = async (filename: string): Promise<FileOutcome> => {
      const filePath = path.join(uploadDir, filename);

      if (path.extname(filename).toLowerCase() !== '.csv') {
        return { report: { filename, status: 'skipped', severity: 'info' } };
      }
      try { await fs.access(filePath); } catch { return failed(filename, 'File not found'); }

      // Detection: filename first; peek only if that misses.
      let ParserClass = findParserForFile(filename);
      if (!ParserClass) {
        let headerChunk: string;
        try { headerChunk = await readHeaderChunk(filePath); }
        catch (e) { return failed(filename, e instanceof Error ? e.message : 'Unknown error'); }
        ParserClass = findParserForFile(filename, headerChunk);
      }
      if (!ParserClass) return { report: { filename, status: 'unmatched', severity: 'info' } };

      // Explicit static parserKey, NOT ParserClass.name — prod minifies class names.
      const parserName = (ParserClass as unknown as { parserKey?: string }).parserKey
        || ParserClass.name.replace('Parser', '').toLowerCase();

      try {
        let result: Record<string, unknown>;
        let primaryDomain: string | null;
        if ((ParserClass as unknown as { streaming?: boolean }).streaming) {
          const Ctor = ParserClass as unknown as new () => AnyStreamingParser;
          const parser = new Ctor();
          await streamCsv(filePath, (row) => parser.consume(row));
          result = parser.finalize();
          primaryDomain = parser.getPrimaryDomain();
        } else {
          const rawContent = await fs.readFile(filePath, 'utf-8');
          const Ctor = ParserClass as unknown as new (content: string) => AnyWholeFileParser;
          const parser = new Ctor(rawContent);
          result = parser.parse();
          primaryDomain = parser.getPrimaryDomain();
        }
        return {
          report: { filename, status: 'parsed', parser: parserName, severity: 'info' },
          success: { parserName, result, filename, primaryDomain },
        };
      } catch (parseError) {
        return failed(filename, parseError instanceof Error ? parseError.message : 'Unknown error');
      }
    };

    const reports: FileReport[] = [];
    const successes: ParseSuccess[] = [];
    for (const filename of sessionFiles) {
      const outcome = await parseOne(filename);
      reports.push(outcome.report);
      if (outcome.success) successes.push(outcome.success);
    }

    const parsersUsed: string[] = [];
    for (const s of successes) {
      aggregator.addParserResult(s.parserName, s.result, s.filename);
      parsersUsed.push(s.parserName);
    }

    const result = aggregator.aggregate();
    result.metadata.parsers_used = Array.from(new Set(parsersUsed));
    result.metadata.file_reports = reports;

    // Detect primary domain: tally hostnames from all parsers' Address columns,
    // pick the most common one (much more reliable than first issue URL).
    if (!result.metadata.site_name) {
      const domainCounts = new Map<string, number>();
      for (const s of successes) {
        if (s.primaryDomain) {
          domainCounts.set(s.primaryDomain, (domainCounts.get(s.primaryDomain) ?? 0) + 1);
        }
      }
      if (domainCounts.size > 0) {
        result.metadata.site_name = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }

    // Fallback: first URL found in any issue
    if (!result.metadata.site_name) {
      const allIssues = [
        ...result.issues.critical,
        ...result.issues.warnings,
        ...result.issues.notices,
      ];
      for (const issue of allIssues) {
        if (issue.urls && issue.urls.length > 0) {
          try {
            const parsed = new URL(issue.urls[0]);
            result.metadata.site_name = parsed.hostname;
            break;
          } catch {
            // not a valid URL, skip
          }
        }
      }
    }

    // Match detected hostname against known client domains
    let clientId: number | null = null;
    const siteHostname = result.metadata.site_name as string | undefined;
    if (siteHostname) {
      const allClients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, domains: true } });
      for (const c of allClients) {
        let clientDomains: string[] = [];
        try { clientDomains = JSON.parse(c.domains); } catch { clientDomains = []; }
        const normHost = normalizeHost(siteHostname);
        const matched = clientDomains.some((d) => {
          const nd = normalizeHost(d);
          return !!normHost && !!nd && (normHost === nd || normHost.endsWith('.' + nd) || nd.endsWith('.' + normHost));
        });
        if (matched) { clientId = c.id; break; }
      }
    }

    // A2 Phase 3: SessionPage rows are no longer written — the pages reader
    // joins CrawlPage + Finding for sessions with a CrawlRun. The deleteMany
    // stays so a retried parse can't leave stale legacy rows behind. The
    // scalar columns on Session are still denormalized here. If the findings
    // dual-write below fails, this session has no per-page data until
    // `npx tsx scripts/findings-rebuild.ts <sessionId>` is run.
    const { scalars } = buildSessionPages(sessionId, result);

    await prisma.$transaction([
      prisma.sessionPage.deleteMany({ where: { sessionId } }),
      prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'complete',
          result: JSON.stringify(result),
          siteName: result.metadata.site_name ?? null,
          clientId,
          siteHost: scalars.siteHost,
          totalUrls: scalars.totalUrls,
          criticalCount: scalars.criticalCount,
          warningCount: scalars.warningCount,
          noticeCount: scalars.noticeCount,
        },
      }),
    ]);

    // Dual-write the normalized findings run (A2). Best-effort: the blob
    // committed above is the source of truth; a findings failure must never
    // fail the parse.
    try {
      await writeSeoFindings(sessionId, result, clientId);
    } catch (err) {
      console.error('[findings] dual-write failed for session', sessionId, err);
    }

    // Fire-and-forget trigger; never throws.
    // Cleanup of uploadDir is the pillar route's responsibility now (it needs
    // the original CSVs to re-parse for per-URL extraction). See app/api/pillar-analysis/route.ts.
    // Keyword-research sessions skip pillar analysis entirely (they generate a
    // keyword strategy memo instead, via /keyword-research).
    if (session.workflow !== 'keyword-research') {
      triggerPillarAnalysis(sessionId).catch((err) =>
        console.error('[pillar-analysis] trigger failed', err)
      );
    }

    return NextResponse.json({ status: 'complete', result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Parse error:', error);

    if (claimedSession) {
      try {
        await prisma.session.update({
          where: { id: sessionId },
          data: { status: 'error', error: message },
        });
      } catch (dbError) {
        console.error('Failed to update session error status:', dbError);
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/parse/:sessionId
 * Remove a session and its uploaded files from disk.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const existing = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Delete the session (cascade deletes ShareLinks via Prisma)
    await prisma.session.delete({ where: { id: sessionId } });

    const [uploadCleanup] = await Promise.allSettled([
      fs.rm(getUploadDir(sessionId), { recursive: true, force: true }),
    ]);
    if (uploadCleanup.status === 'rejected') {
      console.warn(`[parse] Failed to clean uploads for deleted session ${sessionId}:`, uploadCleanup.reason);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/parse/:sessionId
 * Return session status and result.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'pending') {
      let files: string[] = [];
      try { files = JSON.parse(session.files); } catch { files = []; }
      return NextResponse.json({
        status: 'pending',
        message: 'Files uploaded, parsing not started',
        files,
      });
    }

    if (session.status === 'parsing') {
      return NextResponse.json({ status: 'parsing', message: 'Parsing in progress' });
    }

    if (session.status === 'error') {
      return NextResponse.json(
        { status: 'error', error: session.error },
        { status: 500 }
      );
    }

    let result = null;
    try { result = session.result ? JSON.parse(session.result) : null; } catch { result = null; }
    if (!result) {
      // C5: blob pruned (90-d archive) — serve the degraded findings-backed result.
      result = await loadArchivedSeoResult(sessionId);
    }
    return NextResponse.json({ status: 'complete', result });
  } catch (error) {
    console.error('Get parse result error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
