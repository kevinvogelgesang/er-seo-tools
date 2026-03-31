'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { IssuesResult } from '@/lib/types';

const COLORS = { critical: '#ef4444', warnings: '#f59e0b', notices: '#3b82f6' };

export function IssuesPieChart({ issues }: { issues: IssuesResult }) {
  const data = [
    { name: 'Critical', value: issues.critical.length, color: COLORS.critical },
    { name: 'Warnings', value: issues.warnings.length, color: COLORS.warnings },
    { name: 'Notices', value: issues.notices.length, color: COLORS.notices },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No issues found</div>;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number | string | ReadonlyArray<number | string> | undefined) => [value ?? '', '']}
            contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
