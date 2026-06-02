import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClientSeoHistory } from '@/lib/services/client-seo-history';
import { SeoHistoryView } from '@/components/clients/SeoHistoryView';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) return { title: 'Client — ER SEO Tools' };
  const data = await getClientSeoHistory(clientId);
  return { title: data.client ? `${data.client.name} — SEO History` : 'Client — ER SEO Tools' };
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();

  const data = await getClientSeoHistory(clientId);
  if (!data.client) notFound();

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <a
            href="/clients"
            className="text-xs text-gray-400 dark:text-white/40 hover:text-[#f5a623] transition-colors"
          >
            ← Clients
          </a>
          <h1 className="text-3xl font-display font-bold text-[#1c2d4a] dark:text-white mt-1">
            {data.client.name} <span className="text-gray-400 dark:text-white/40 font-normal">— SEO History</span>
          </h1>
        </div>
        <SeoHistoryView sessions={data.sessions} latestTwo={data.latestTwo} lastAuditedAt={data.lastAuditedAt} />
      </div>
    </div>
  );
}
