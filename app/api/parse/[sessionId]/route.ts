import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';
import { findParserForFile } from '@/lib/parsers';
import { AggregatorService } from '@/lib/services/aggregator.service';

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
    const sessionFiles = JSON.parse(session.files) as string[];

    const aggregator = new AggregatorService();
    const parsersUsed: string[] = [];
    const errors: string[] = [];

    for (const filename of sessionFiles) {
      const filePath = path.join(uploadDir, filename);

      if (!fs.existsSync(filePath)) {
        errors.push(`File not found: ${filename}`);
        continue;
      }

      const ParserClass = findParserForFile(filename);
      if (!ParserClass) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ParserConstructor = ParserClass as unknown as new (
          content: string
        ) => { parse(): Record<string, unknown> };
        const parser = new ParserConstructor(content);
        const result = parser.parse();

        const parserName = ParserClass.name.replace('Parser', '').toLowerCase();
        aggregator.addParserResult(parserName, result, filename);
        parsersUsed.push(parserName);
      } catch (parseError) {
        const message =
          parseError instanceof Error ? parseError.message : 'Unknown error';
        errors.push(`Error parsing ${filename}: ${message}`);
      }
    }

    const result = aggregator.aggregate();
    result.metadata.parsers_used = Array.from(new Set(parsersUsed));

    if (errors.length > 0) {
      (result as unknown as Record<string, unknown>).parsing_errors = errors;
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'complete',
        result: JSON.stringify(result),
      },
    });

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
      return NextResponse.json({
        status: 'pending',
        message: 'Files uploaded, parsing not started',
        files: JSON.parse(session.files),
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

    const result = session.result ? JSON.parse(session.result) : null;
    return NextResponse.json({ status: 'complete', result });
  } catch (error) {
    console.error('Get parse result error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
