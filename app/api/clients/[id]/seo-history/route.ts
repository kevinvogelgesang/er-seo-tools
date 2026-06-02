import { NextRequest, NextResponse } from 'next/server';
import { getClientSeoHistory } from '@/lib/services/client-seo-history';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 });
  const data = await getClientSeoHistory(clientId);
  if (!data.client) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(data);
}
