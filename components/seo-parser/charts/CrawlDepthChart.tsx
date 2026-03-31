'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function CrawlDepthChart({ distribution }: { distribution: Record<number, number> }) {
  const data = Object.entries(distribution)
    .map(([depth, count]) => ({ depth: `Depth ${depth}`, count }))
    .sort((a, b) => parseInt(a.depth.split(' ')[1]) - parseInt(b.depth.split(' ')[1]));

  if (data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No crawl depth data</div>;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="depth" tick={{ fontSize: 12 }} />
          <YAxis />
          <Tooltip formatter={(value: number | string | ReadonlyArray<number | string> | undefined) => [typeof value === 'number' ? value.toLocaleString() : String(value ?? ''), 'Pages']}
            contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
          />
          <Bar dataKey="count" fill="#1c2d4a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
