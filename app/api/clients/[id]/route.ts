import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/clients/:id — update name and/or domains */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const data: { name?: string; domains?: string; seedUrls?: string | null; seedUrlsUpdatedAt?: Date | null } = {};

    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      data.name = name;
    }

    if (Array.isArray(body?.domains)) {
      const domains: string[] = body.domains
        .map((d: unknown) => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
        .filter(Boolean);
      data.domains = JSON.stringify(domains);
    }

    if ('seedUrls' in body) {
      if (body.seedUrls === null) {
        data.seedUrls = null;
        data.seedUrlsUpdatedAt = null;
      } else if (Array.isArray(body.seedUrls)) {
        const urls = (body.seedUrls as unknown[])
          .map((u: unknown) => (typeof u === 'string' ? u.trim() : ''))
          .filter(Boolean);
        data.seedUrls = urls.length > 0 ? JSON.stringify(urls) : null;
        data.seedUrlsUpdatedAt = urls.length > 0 ? new Date() : null;
      } else {
        return NextResponse.json({ error: 'seedUrls must be an array or null' }, { status: 400 });
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data,
      select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, createdAt: true },
    });

    let domains: string[] = [];
    try { domains = JSON.parse(client.domains); } catch { domains = []; }
    let seedUrls: string[] | null = null;
    if (client.seedUrls) { try { seedUrls = JSON.parse(client.seedUrls); } catch { seedUrls = null; } }

    return NextResponse.json({ ...client, domains, seedUrls });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'P2025') return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      if (code === 'P2002') return NextResponse.json({ error: 'A client with that name already exists' }, { status: 409 });
    }
    console.error('PATCH /api/clients/:id error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/clients/:id — delete a client (sessions get clientId = null) */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  try {
    await prisma.client.delete({ where: { id: clientId } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    console.error('DELETE /api/clients/:id error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
