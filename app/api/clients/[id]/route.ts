import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeClientDomains, InvalidDomainError } from '@/lib/security/domain-validation';

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

    // Archive/restore is exclusive of other updates — one intent per request.
    if (body && typeof body === 'object' && 'archived' in body) {
      if (Object.keys(body).length > 1) {
        return NextResponse.json({ error: 'archived cannot be combined with other updates' }, { status: 400 });
      }
      if (typeof body.archived !== 'boolean') {
        return NextResponse.json({ error: 'archived must be boolean' }, { status: 400 });
      }
      try {
        if (body.archived) {
          // Archiving also stops the client's scheduled scans (array-form txn).
          await prisma.$transaction([
            prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } }),
            prisma.schedule.updateMany({ where: { clientId, enabled: true }, data: { enabled: false } }),
          ]);
        } else {
          // Restore nulls archivedAt only — schedules stay disabled (manual re-enable).
          await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } });
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
          return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }
        throw err;
      }
      const fresh = await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, teamworkTasklistId: true, archivedAt: true, createdAt: true },
      });
      if (!fresh) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      let freshDomains: string[] = [];
      try { freshDomains = JSON.parse(fresh.domains); } catch { freshDomains = []; }
      let freshSeedUrls: string[] | null = null;
      if (fresh.seedUrls) { try { freshSeedUrls = JSON.parse(fresh.seedUrls); } catch { freshSeedUrls = null; } }
      return NextResponse.json({ ...fresh, domains: freshDomains, seedUrls: freshSeedUrls });
    }

    const data: { name?: string; domains?: string; seedUrls?: string | null; seedUrlsUpdatedAt?: Date | null; teamworkTasklistId?: string | null } = {};

    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      data.name = name;
    }

    if (Array.isArray(body?.domains)) {
      // Server-side validation: hostname-only, normalized, deduped. Rejects
      // schemes/paths/ports/IPs/internal names so malformed values never persist.
      try {
        data.domains = JSON.stringify(normalizeClientDomains(body.domains));
      } catch (err) {
        if (err instanceof InvalidDomainError) {
          return NextResponse.json({ error: 'invalid_domain' }, { status: 400 });
        }
        throw err;
      }
    }

    if ('teamworkTasklistId' in body) {
      const v = body.teamworkTasklistId;
      data.teamworkTasklistId = typeof v === 'string' && v.trim() ? v.trim() : null;
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
      select: { id: true, name: true, domains: true, seedUrls: true, seedUrlsUpdatedAt: true, teamworkTasklistId: true, createdAt: true },
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

/** DELETE /api/clients/:id — hard-delete an ARCHIVED client (sessions get clientId = null). Active clients must be archived first. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (isNaN(clientId)) {
    return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
  }

  try {
    const existing = await prisma.client.findUnique({ where: { id: clientId }, select: { archivedAt: true } });
    if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    if (existing.archivedAt == null) {
      return NextResponse.json({ error: 'archive_first' }, { status: 409 });
    }
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
