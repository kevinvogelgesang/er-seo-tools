import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/analytics/google/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/google/gsc-sites
 *
 * Returns the list of Search Console sites the service account has access to,
 * as [{ siteUrl: string }]. siteUrl values are VERBATIM — sc-domain: prefixes
 * are never normalized (sc-domain:example.com and https://example.com/ are
 * different GSC property types).
 *
 * Returns 503 when the service-account key is missing or invalid.
 * Cookie-gated by global middleware.
 */
export async function GET(_request: NextRequest) {
  const authResult = await getAuthClient();
  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message ?? 'Google service-account auth is not configured' },
      { status: 503 }
    );
  }

  try {
    const sc = google.searchconsole({ version: 'v1', auth: authResult.auth });
    const response = await sc.sites.list({});
    const siteEntry = response.data.siteEntry ?? [];

    const sites = siteEntry
      .filter((entry) => typeof entry.siteUrl === 'string')
      .map((entry) => ({ siteUrl: entry.siteUrl as string }));

    return NextResponse.json(sites);
  } catch (err: unknown) {
    console.error('GET /api/google/gsc-sites error:', err);
    return NextResponse.json({ error: 'Failed to fetch GSC sites' }, { status: 500 });
  }
}
