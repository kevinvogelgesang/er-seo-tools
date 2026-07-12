import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifySeoRoadmapToken, SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic } from '@/lib/events/topics';

const REQUIRED_SCOPE = 'roadmap-write';
const MAX_ROADMAP_CHARS = 50_000;
const MAX_STRUCTURED_CHARS = 200_000;

function tokenErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired')) return 'token_expired';
  if (m.includes('does not match')) return 'token_wrong_roadmap_id';
  if (m.includes('signature')) return 'token_invalid_signature';
  return 'token_invalid';
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. Parse + validate body shape (before auth so malformed request gets 400 not 401)
  let body: { roadmap?: unknown; structured?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.roadmap !== 'string' || body.roadmap.length === 0) {
    return NextResponse.json({ error: 'roadmap_required' }, { status: 400 });
  }
  if (body.roadmap.length > MAX_ROADMAP_CHARS) {
    return NextResponse.json({ error: 'roadmap_too_long' }, { status: 400 });
  }
  const roadmapMarkdown = body.roadmap;

  let structured: string | undefined;
  if (body.structured !== undefined) {
    // Must be an object/array — reject a pre-stringified or primitive value to avoid double-encoding.
    if (typeof body.structured !== 'object' || body.structured === null) {
      return NextResponse.json({ error: 'structured_invalid' }, { status: 400 });
    }
    structured = JSON.stringify(body.structured);
    if (structured.length > MAX_STRUCTURED_CHARS) {
      return NextResponse.json({ error: 'structured_too_long' }, { status: 400 });
    }
  }

  // 2. Auth header
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  }
  const match = authHeader.match(/^Bearer\s+(srt_\S+)$/);
  if (!match) {
    return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });
  }

  // 3. Token verify
  let payload;
  try {
    payload = await verifySeoRoadmapToken(match[1], id);
  } catch (err) {
    if (err instanceof SeoRoadmapTokenError) {
      return NextResponse.json({ error: tokenErrorCode(err.message) }, { status: 401 });
    }
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }

  // 4. Scope check
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });
  }

  // 5. Find roadmap
  const existing = await prisma.seoRoadmap.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 6. Update + respond
  const now = new Date();
  const updated = await prisma.seoRoadmap.update({
    where: { id },
    data: {
      roadmapMarkdown,
      ...(structured !== undefined ? { structured } : {}),
      status: 'complete',
      error: null,
      roadmapUpdatedAt: now,
    },
  });

  // A5 Task 24: SeoRoadmapCard subscribes to memo:<Session.id> (the id it
  // polls by via /api/seo-roadmap/by-session/[sessionId]) — NOT the route's
  // own `id` param, which is this SeoRoadmap row's own (different) primary
  // key. Emitted AFTER the awaited update resolves (a resolved update()
  // always succeeded — P2025 on a missing row throws and never reaches here).
  publishInvalidation(memoTopic(updated.sessionId));

  return NextResponse.json({
    ok: true,
    updatedAt: (updated.roadmapUpdatedAt ?? now).toISOString(),
  });
}
