import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuthClient } from '@/lib/analytics/google/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/google/properties
 *
 * Returns the list of GA4 properties the service account has been granted
 * access to, as [{ propertyId: number, displayName: string }].
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
    const admin = google.analyticsadmin({ version: 'v1beta', auth: authResult.auth });
    const response = await admin.accountSummaries.list({});
    const accountSummaries = response.data.accountSummaries ?? [];

    const properties: Array<{ propertyId: number; displayName: string }> = [];

    for (const account of accountSummaries) {
      for (const prop of account.propertySummaries ?? []) {
        // property is like 'properties/123456789' — parse the numeric id
        const raw = prop.property ?? '';
        const numericStr = raw.replace(/^properties\//, '');
        const propertyId = parseInt(numericStr, 10);
        if (!isNaN(propertyId)) {
          properties.push({ propertyId, displayName: prop.displayName ?? '' });
        }
      }
    }

    return NextResponse.json(properties);
  } catch (err: unknown) {
    console.error('[google/properties] fetch error:', (err as Error).message);
    return NextResponse.json({ error: 'Failed to fetch GA4 properties' }, { status: 500 });
  }
}
