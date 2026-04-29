import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';
import { findParserForFile } from '@/lib/parsers';
import { AggregatorService } from '@/lib/services/aggregator.service';
import { triggerPillarAnalysis } from '../pillar-analysis-trigger';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/parse/:sessionId
 * Run all parsers on the uploaded files for this session.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'parsing') {
      return NextResponse.json({ error: 'Parsing already in progress' }, { status: 409 });
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'parsing', error: null },
    });

    const uploadDir = getUploadDir(sessionId);
    let sessionFiles: string[] = [];
    try {
      const parsed = JSON.parse(session.files);
      sessionFiles = Array.isArray(parsed) ? parsed : [];
    } catch {
      sessionFiles = [];
    }

    const aggregator = new AggregatorService();
    const parsersUsed: string[] = [];
    const errors: string[] = [];

    // Parse all files in parallel (read + parse concurrently, aggregate serially after)
    type AnyParser = { parse(): Record<string, unknown>; getPrimaryDomain(): string | null };
    type ParseSuccess = { parserName: string; result: Record<string, unknown>; filename: string; primaryDomain: string | null };
    const parsePromises = sessionFiles.map(async (filename): Promise<ParseSuccess | null> => {
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
    });

    const parseResults = await Promise.all(parsePromises);
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

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'complete',
        result: JSON.stringify(result),
        siteName: result.metadata.site_name ?? null,
        clientId,
      },
    });

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

    try {
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'error', error: message },
      });
    } catch (dbError) {
      console.error('Failed to update session error status:', dbError);
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
    // Delete upload files first
    const uploadDir = getUploadDir(sessionId);
    try {
      await fs.rm(uploadDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist — that's fine
    }

    // Delete the session (cascade deletes ShareLinks via Prisma)
    await prisma.session.delete({ where: { id: sessionId } });

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
