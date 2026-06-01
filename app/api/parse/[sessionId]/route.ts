import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';
import { findParserForFile } from '@/lib/parsers';
import { AggregatorService } from '@/lib/services/aggregator.service';
import { triggerPillarAnalysis } from '../pillar-analysis-trigger';
import { buildSessionPages } from '@/lib/services/session-page-builder';

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
    const parsersUsed: string[] = [];
    const errors: string[] = [];

    // Parse files sequentially to avoid full-file memory spikes on large crawl exports.
    type AnyParser = { parse(): Record<string, unknown>; getPrimaryDomain(): string | null };
    type ParseSuccess = { parserName: string; result: Record<string, unknown>; filename: string; primaryDomain: string | null };
    const parseFile = async (filename: string): Promise<ParseSuccess | null> => {
      const filePath = path.join(uploadDir, filename);

      if (filename.endsWith('.txt')) return null;

      try {
        await fs.access(filePath);
      } catch {
        errors.push(`File not found: ${filename}`);
        return null;
      }

      let rawContent: string;
      try {
        rawContent = await fs.readFile(filePath, 'utf-8');
      } catch (readError) {
        const message = readError instanceof Error ? readError.message : 'Unknown error';
        errors.push(`Error reading ${filename}: ${message}`);
        return null;
      }

      const ParserClass = findParserForFile(filename, rawContent);
      if (!ParserClass) return null;

      try {
        const content = rawContent;
        const ParserConstructor = ParserClass as unknown as new (content: string) => AnyParser;
        const parser = new ParserConstructor(content);
        const result = parser.parse();
        const primaryDomain = parser.getPrimaryDomain();
        const parserName = ParserClass.name.replace('Parser', '').toLowerCase();
        return { parserName, result, filename, primaryDomain };
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Unknown error';
        errors.push(`Error parsing ${filename}: ${message}`);
        return null;
      }
    };

    const parseResults: Array<ParseSuccess | null> = [];
    for (const filename of sessionFiles) {
      parseResults.push(await parseFile(filename));
    }
    for (const res of parseResults) {
      if (res) {
        aggregator.addParserResult(res.parserName, res.result, res.filename);
        parsersUsed.push(res.parserName);
      }
    }

    const result = aggregator.aggregate();
    result.metadata.parsers_used = Array.from(new Set(parsersUsed));

    if (errors.length > 0) {
      (result as unknown as Record<string, unknown>).parsing_errors = errors;
    }

    // Detect primary domain: tally hostnames from all parsers' Address columns,
    // pick the most common one (much more reliable than first issue URL).
    if (!result.metadata.site_name) {
      const domainCounts = new Map<string, number>();
      for (const res of parseResults) {
        if (res?.primaryDomain) {
          domainCounts.set(res.primaryDomain, (domainCounts.get(res.primaryDomain) ?? 0) + 1);
        }
      }
      if (domainCounts.size > 0) {
        result.metadata.site_name = [...domainCounts.entries()]
          .sort((a, b) => b[1] - a[1])[0][0];
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
      const allClients = await prisma.client.findMany({ select: { id: true, domains: true } });
      for (const c of allClients) {
        let clientDomains: string[] = [];
        try { clientDomains = JSON.parse(c.domains); } catch { clientDomains = []; }
        const matched = clientDomains.some(
          (d) => siteHostname === d || siteHostname.endsWith('.' + d) || d.endsWith('.' + siteHostname)
        );
        if (matched) { clientId = c.id; break; }
      }
    }

    const { pages, scalars } = buildSessionPages(sessionId, result);

    // Chunk createMany — a 1000-row insert can hit SQLite's bound-variable limit.
    const chunk = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    const pageChunks = chunk(pages, 75);

    await prisma.$transaction([
      prisma.sessionPage.deleteMany({ where: { sessionId } }),
      ...pageChunks.map((data) => prisma.sessionPage.createMany({ data })),
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

    // Fire-and-forget trigger; never throws.
    // Cleanup of uploadDir is the pillar route's responsibility now (it needs
    // the original CSVs to re-parse for per-URL extraction). See app/api/pillar-analysis/route.ts.
    triggerPillarAnalysis(sessionId).catch((err) =>
      console.error('[pillar-analysis] trigger failed', err)
    );

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
    return NextResponse.json({ status: 'complete', result });
  } catch (error) {
    console.error('Get parse result error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
