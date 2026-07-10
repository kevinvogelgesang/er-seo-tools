import { NextRequest, NextResponse } from 'next/server';
import { withRoute } from '@/lib/api/with-route';
import { refreshGscSnapshot, getLatestGscSnapshot } from '@/lib/keywords/gsc-snapshot';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/clients/:id/gsc-snapshot
 *
 * Returns the client's latest mapping-matched GSC keyword snapshot:
 *   { gscMapped, summary }
 * No client-existence 404 — a missing client returns gscMapped:false,
 * consistent with getLatestGscSnapshot (spec §5.4).
 * Cookie-gated by global middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  const { gscMapped, summary } = await getLatestGscSnapshot(clientId);
  return NextResponse.json({ gscMapped, summary });
});

/**
 * POST /api/clients/:id/gsc-snapshot
 *
 * Refreshes the client's GSC keyword snapshot. Maps the service's
 * RefreshGscSnapshotResult to an honest error envelope (spec §5.4):
 *   ok             -> 200 { summary }
 *   client_not_found -> 404 { error: 'Client not found' }
 *   not_mapped     -> 409 { error: 'gsc_not_mapped' }
 *   access_denied  -> 409 { error: 'gsc_access_denied' }
 *   quota          -> 429 { error: 'gsc_quota' }
 *   auth           -> 502 { error: 'gsc_auth' }
 *   error          -> 502 { error: 'gsc_error' }
 * The service's `message`, when present, rides along as a `message` field.
 * Cookie-gated by global middleware.
 */
export const POST = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  const result = await refreshGscSnapshot(clientId);

  if (result.ok) {
    return NextResponse.json({ summary: result.summary });
  }

  const STATUS_BY_REASON = {
    client_not_found: 404,
    not_mapped: 409,
    access_denied: 409,
    quota: 429,
    auth: 502,
    error: 502,
  } as const;

  const ERROR_BY_REASON = {
    client_not_found: 'Client not found',
    not_mapped: 'gsc_not_mapped',
    access_denied: 'gsc_access_denied',
    quota: 'gsc_quota',
    auth: 'gsc_auth',
    error: 'gsc_error',
  } as const;

  const body: { error: string; message?: string } = { error: ERROR_BY_REASON[result.reason] };
  if (result.message !== undefined) {
    body.message = result.message;
  }

  return NextResponse.json(body, { status: STATUS_BY_REASON[result.reason] });
});
