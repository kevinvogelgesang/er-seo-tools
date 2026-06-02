import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { KeywordSignalsPanel } from '@/components/seo-parser/KeywordSignalsPanel';
import { KeywordMemoCard } from '@/components/keyword-research/KeywordMemoCard';
import type { AggregatedResult } from '@/lib/types';
import type { Metadata } from 'next';

type Props = { params: Promise<{ sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId } = await params;
  return { title: `Keyword Research — ${sessionId.slice(0, 8)}` };
}

function parseStoredResult(raw: string | null): AggregatedResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AggregatedResult;
  } catch {
    return null;
  }
}

export default async function KeywordResearchResultsPage({ params }: Props) {
  const { sessionId } = await params;

  // Intentionally NOT gated on session.workflow: the keyword memo works for ANY session that
  // has keyword_signals (a technical upload that included SEMRush exports is fine). The workflow
  // marker only keeps keyword-origin uploads out of the technical history/trends.
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    notFound();
  }

  const result = parseStoredResult(session.result);
  const keywordSignals = result?.keyword_signals ?? null;

  const row = await prisma.keywordResearchSession.findUnique({ where: { sessionId } });

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-extrabold text-3xl text-[#1c2d4a] dark:text-white mb-2">
            Keyword Research
          </h1>
          <p className="text-gray-600 dark:text-white/60 text-sm leading-relaxed">
            {session.siteName ? `Keyword signals for ${session.siteName}.` : 'Keyword signals from your SEMRush exports.'}
          </p>
        </div>

        {/* Keyword signals */}
        {keywordSignals ? (
          <KeywordSignalsPanel data={keywordSignals} />
        ) : (
          <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border px-6 py-4">
            <p className="text-sm text-gray-500 dark:text-white/50">
              No SEMRush keyword data in this upload. Upload Organic Positions / Pages or a Keyword
              Gap &ldquo;Missing&rdquo; export to see keyword signals.
            </p>
          </div>
        )}

        {/* Keyword strategy memo */}
        <KeywordMemoCard
          sessionId={sessionId}
          initialStatus={row?.status ?? 'none'}
          initialMemoMarkdown={row?.memoMarkdown ?? null}
          initialMemoUpdatedAt={row?.memoUpdatedAt ? row.memoUpdatedAt.toISOString() : null}
          initialTokenMintedAt={row?.tokenMintedAt ? row.tokenMintedAt.toISOString() : null}
        />
      </div>
    </div>
  );
}
