// app/api/pillar-analysis/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPillarToken, PillarTokenError } from '@/lib/pillar-token';
import { buildNarrativePayload } from '@/lib/services/pillarAnalysis/narrativePayload';

const REQUIRED_SCOPE = 'read';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  }
  const match = authHeader.match(/^Bearer\s+(pat_\S+)$/);
  if (!match) {
    return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });
  }
  const token = match[1];

  let payload;
  try {
    payload = await verifyPillarToken(token, id);
  } catch (err) {
    if (err instanceof PillarTokenError) {
      const msg = err.message.toLowerCase();
      const code = msg.includes('expired')
        ? 'token_expired'
        : msg.includes('does not match')
          ? 'token_wrong_analysis_id'
          : msg.includes('signature')
            ? 'token_invalid_signature'
            : 'token_invalid';
      return NextResponse.json({ error: code }, { status: 401 });
    }
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }

  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });
  }

  const pa = await prisma.pillarAnalysis.findUnique({
    where: { id },
    include: { session: true },
  });
  if (!pa) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(buildNarrativePayload(pa));
}
