// app/api/pillar-analysis/[id]/mint-token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { mintPillarToken, PillarTokenError } from '@/lib/pillar-token';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (pa.status !== 'complete') {
    return NextResponse.json(
      { error: 'not_complete', status: pa.status },
      { status: 409 },
    );
  }

  try {
    const minted = await mintPillarToken(pa.id);
    return NextResponse.json(minted);
  } catch (err) {
    if (err instanceof PillarTokenError) {
      // eslint-disable-next-line no-console
      console.error('[pillar-token] mint failed:', err.message);
      return NextResponse.json(
        { error: 'token_service_unavailable' },
        { status: 500 },
      );
    }
    throw err;
  }
}
