import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';
import { AggregatedResult } from '@/lib/types';
import { buildTechnicalAuditExport } from '@/lib/parsers/claude-export-builder';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, result: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'complete' || !session.result) {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    const full = JSON.parse(session.result) as AggregatedResult;
    const export_ = buildTechnicalAuditExport(full);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify(export_, null, 2)));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="technical-audit-claude-${sessionId.slice(0, 8)}.json"`,
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Claude export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
