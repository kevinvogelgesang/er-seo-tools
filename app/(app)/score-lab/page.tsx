import type { Metadata } from 'next'
import { ScoreLabClient } from '@/components/score-lab/ScoreLabClient'

export const metadata: Metadata = { title: 'Score Lab — ER SEO Tools' }

export default function ScoreLabPage() {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">Score Lab</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Pick a recent run, drag the weights, and watch the score recompute live — nothing is saved until you say so.
          </p>
        </div>
        <ScoreLabClient />
      </div>
    </div>
  )
}
