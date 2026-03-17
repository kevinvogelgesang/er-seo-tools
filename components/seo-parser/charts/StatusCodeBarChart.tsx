'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CrawlSummary } from '@/lib/types';

const COLORS = { '2xx': '#22c55e', '3xx': '#3b82f6', '4xx': '#f97316', '5xx': '#ef4444' };

export function StatusCodeBarChart({ summary }: { summary: CrawlSummary }) {
  const data = [
    { name: '2xx OK', value: summary.ok_responses || 0, color: COLORS['2xx'] },
    { name: '3xx Redirect', value: summary.redirects || 0, color: COLORS['3xx'] },
    { name: '4xx Client', value: summary.client_errors || 0, color: COLORS['4xx'] },
    { name: '5xx Server', value: summary.server_errors || 0, color: COLORS['5xx'] },
  ];

  if (!data.some((d) => d.value > 0)) {
    return <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No status code data</div>;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
          <XAxis type="number" />
          <YAxis dataKey="name" type="category" width={80} />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip formatter={(value: any) => [typeof value === 'number' ? value.toLocaleString() : value, 'Count']}
            contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
