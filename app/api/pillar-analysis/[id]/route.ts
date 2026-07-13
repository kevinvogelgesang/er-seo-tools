// app/api/pillar-analysis/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireHandoffToken } from '@/lib/handoff/route-auth';
import { buildNarrativePayload } from '@/lib/services/pillarAnalysis/narrativePayload';

const REQUIRED_SCOPE = 'read';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireHandoffToken(req, 'pat', id, REQUIRED_SCOPE);
  if (!auth.ok) return auth.response;

  const pa = await prisma.pillarAnalysis.findUnique({
    where: { id },
    include: { session: true },
  });
  if (!pa) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(buildNarrativePayload(pa));
}
