import { NextRequest, NextResponse } from 'next/server';
import { buildBriefFromCanonical } from '@/lib/services/brief-from-canonical';

export const dynamic = 'force-dynamic';

/**
 * POST /api/brief/live
 * Generate an AI-ready SEO brief from the canonical live-scan (or SF-upload)
 * run for a given client + domain.
 *
 * Body: { clientId: number, domain: string }
 *
 * Schema and keyword sections are degraded (empty) because live-scan facts
 * carry no SEMrush keyword data and no structured-data export.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const { clientId, domain } = body as Record<string, unknown>;

  if (typeof clientId !== 'number' || !Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'clientId must be a positive integer' }, { status: 400 });
  }

  if (typeof domain !== 'string' || !domain.trim()) {
    return NextResponse.json({ error: 'domain must be a non-empty string' }, { status: 400 });
  }

  try {
    const result = await buildBriefFromCanonical({ clientId, domain: domain.trim() });

    if (!result) {
      return NextResponse.json(
        { error: 'No canonical SEO run found for this client and domain' },
        { status: 404 },
      );
    }

    return NextResponse.json({ brief: result.brief, stats: result.stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[brief/live] generation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
