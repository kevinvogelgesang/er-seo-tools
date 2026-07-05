import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withRoute } from '@/lib/api/with-route';
import { parseJsonBody } from '@/lib/api/body';

export const dynamic = 'force-dynamic';

/** GET /api/clients — list active clients (?includeArchived=1 for all) */
export const GET = withRoute(async (request: NextRequest) => {
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === '1';
  const clients = await prisma.client.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, teamworkTasklistId: true, archivedAt: true, createdAt: true },
  });

  const formatted = clients.map((c) => {
    let domains: string[] = [];
    try { domains = JSON.parse(c.domains); } catch { domains = []; }
    let seedUrls: string[] | null = null;
    if (c.seedUrls) { try { seedUrls = JSON.parse(c.seedUrls); } catch { seedUrls = null; } }
    return { ...c, domains, seedUrls };
  });

  return NextResponse.json(formatted);
});

/** POST /api/clients — create a client */
export const POST = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody<{ name?: unknown }>(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const client = await prisma.client.create({
      data: { name },
      select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, teamworkTasklistId: true, createdAt: true },
    });

    return NextResponse.json({ ...client, domains: [], seedUrls: null }, { status: 201 });
  } catch (error: unknown) {
    // Preserve the human-readable duplicate-name message; withRoute's generic
    // Prisma net only maps P2002 -> { error: 'conflict' }, which would change this string.
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A client with that name already exists' }, { status: 409 });
    }
    throw error;
  }
});
