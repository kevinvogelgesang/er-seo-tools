import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/clients — list all clients */
export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, createdAt: true },
    });

    const formatted = clients.map((c) => {
      let domains: string[] = [];
      try { domains = JSON.parse(c.domains); } catch { domains = []; }
      let seedUrls: string[] | null = null;
      if (c.seedUrls) { try { seedUrls = JSON.parse(c.seedUrls); } catch { seedUrls = null; } }
      return { ...c, domains, seedUrls };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('GET /api/clients error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/clients — create a client */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const client = await prisma.client.create({
      data: { name },
      select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, createdAt: true },
    });

    return NextResponse.json({ ...client, domains: [], seedUrls: null }, { status: 201 });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A client with that name already exists' }, { status: 409 });
    }
    console.error('POST /api/clients error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
