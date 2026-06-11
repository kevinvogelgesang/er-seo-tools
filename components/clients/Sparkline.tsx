'use client'

// components/clients/Sparkline.tsx
// Minimal score sparkline. Loaded via next/dynamic ssr:false from Scorecard.

import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'

export interface SparklinePoint { date: string; score: number }

export function Sparkline({ points, color = '#f5a623' }: { points: SparklinePoint[]; color?: string }) {
  if (points.length < 2) return <div className="h-10" aria-hidden="true" />
  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
