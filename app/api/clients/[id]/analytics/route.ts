import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

const ANALYTICS_SELECT = {
  ga4PropertyId: true,
  gscSiteUrl: true,
  crmClientRef: true,
} as const;

/**
 * GET /api/clients/:id/analytics
 *
 * Returns the client's current Analytics-IDs mapping:
 *   { ga4PropertyId, gscSiteUrl, crmClientRef }
 *
 * 404 if the client does not exist.
 * Cookie-gated by global middleware.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: ANALYTICS_SELECT,
  });

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json(client);
}

/**
 * PATCH /api/clients/:id/analytics
 *
 * Accepts any subset of { ga4PropertyId, gscSiteUrl, crmClientRef }.
 * Each field must be a string or null — type-only validation; values stored RAW.
 * gscSiteUrl is NEVER normalized (sc-domain: vs https:// are different GSC
 * property types — the caller must supply the exact string from the picker).
 *
 * 400 if no valid fields supplied, or a field is the wrong type.
 * 404 if the client does not exist.
 * Returns the updated mapping on success.
 * Cookie-gated by global middleware.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const data: { ga4PropertyId?: string | null; gscSiteUrl?: string | null; crmClientRef?: string | null } = {};

  const FIELDS = ['ga4PropertyId', 'gscSiteUrl', 'crmClientRef'] as const;

  for (const field of FIELDS) {
    if (!(field in raw)) continue;
    const val = raw[field];
    if (val === null) {
      data[field] = null;
    } else if (typeof val === 'string') {
      // Normalize ga4PropertyId: strip leading 'properties/' prefix and trim whitespace
      if (field === 'ga4PropertyId') {
        let normalized = val.trim();
        if (normalized.startsWith('properties/')) {
          normalized = normalized.substring('properties/'.length);
        }
        data[field] = normalized;
      } else {
        // gscSiteUrl and crmClientRef stored verbatim
        data[field] = val;
      }
    } else {
      return NextResponse.json(
        { error: `${field} must be a string or null` },
        { status: 400 }
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const updated = await prisma.client.update({
      where: { id: clientId },
      data,
      select: ANALYTICS_SELECT,
    });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    console.error('PATCH /api/clients/:id/analytics error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
