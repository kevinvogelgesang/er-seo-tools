import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireHandoffToken } from '@/lib/handoff/route-auth';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic } from '@/lib/events/topics';

const REQUIRED_SCOPE = 'memo-write';
const MAX_MEMO_CHARS = 50_000;
const MAX_STRUCTURED_CHARS = 200_000;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. Parse + validate body shape (before auth so malformed request gets 400 not 401)
  let body: { memo?: unknown; structured?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.memo !== 'string' || body.memo.length === 0) {
    return NextResponse.json({ error: 'memo_required' }, { status: 400 });
  }
  if (body.memo.length > MAX_MEMO_CHARS) {
    return NextResponse.json({ error: 'memo_too_long' }, { status: 400 });
  }
  const memoMarkdown = body.memo;

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

  // 2. Auth
  const auth = await requireHandoffToken(req, 'krt', id, REQUIRED_SCOPE);
  if (!auth.ok) return auth.response;

  // 5. Find session
  const existing = await prisma.keywordResearchSession.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 6. Update + respond
  const now = new Date();
  const updated = await prisma.keywordResearchSession.update({
    where: { id },
    data: {
      memoMarkdown,
      ...(structured !== undefined ? { structured } : {}),
      status: 'complete',
      error: null,
      memoUpdatedAt: now,
    },
  });

  // A5 Task 24: KeywordMemoCard subscribes to memo:<Session.id> (the id it
  // polls by via /api/keyword-memo/by-session/[sessionId]) — NOT the route's
  // own `id` param, which is this KeywordResearchSession row's own (different)
  // primary key. Emitted AFTER the awaited update resolves (a resolved
  // update() always succeeded — P2025 on a missing row throws first).
  publishInvalidation(memoTopic(updated.sessionId));

  return NextResponse.json({
    ok: true,
    updatedAt: (updated.memoUpdatedAt ?? now).toISOString(),
  });
}
