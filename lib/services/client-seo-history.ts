import { prisma } from '@/lib/db';

export interface ClientSeoHistorySession {
  id: string;
  createdAt: string;   // ISO
  siteName: string | null;
  siteHost: string | null;
  totalUrls: number | null;
  criticalCount: number | null;
  warningCount: number | null;
  noticeCount: number | null;
}
export interface ClientSeoHistory {
  client: { id: number; name: string } | null;
  sessions: ClientSeoHistorySession[];
  latestTwo: [string, string] | null;
  lastAuditedAt: string | null;
}

export async function getClientSeoHistory(clientId: number): Promise<ClientSeoHistory> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) return { client: null, sessions: [], latestTwo: null, lastAuditedAt: null };

  const rows = await prisma.session.findMany({
    where: { clientId, status: 'complete' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, createdAt: true, siteName: true, siteHost: true,
      totalUrls: true, criticalCount: true, warningCount: true, noticeCount: true,
    },
  });

  const sessions: ClientSeoHistorySession[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    siteName: r.siteName,
    siteHost: r.siteHost,
    totalUrls: r.totalUrls,
    criticalCount: r.criticalCount,
    warningCount: r.warningCount,
    noticeCount: r.noticeCount,
  }));

  const latestTwo = sessions.length >= 2
    ? ([sessions[sessions.length - 2].id, sessions[sessions.length - 1].id] as [string, string])
    : null;
  const lastAuditedAt = sessions.length ? sessions[sessions.length - 1].createdAt : null;

  return { client, sessions, latestTwo, lastAuditedAt };
}
