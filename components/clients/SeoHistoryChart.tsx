'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChartSession {
  createdAt: string;
  criticalCount: number | null;
  warningCount: number | null;
  noticeCount: number | null;
}

const COLORS = { critical: '#ef4444', warning: '#f97316', notice: '#3b82f6' };

export function SeoHistoryChart({ sessions }: { sessions: ChartSession[] }) {
  // Old sessions store null scalar counts — exclude them from the trend.
  const plottable = sessions.filter(
    (s) => s.criticalCount != null && s.warningCount != null && s.noticeCount != null
  );

  if (plottable.length < 1) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-500 dark:text-white/50 text-sm">
        Not enough trend data yet
      </div>
    );
  }

  // Key the X axis on the full ISO timestamp so multiple same-day crawls don't collapse;
  // format to a short date label only for display.
  const data = plottable.map((s) => ({
    date: s.createdAt,
    critical: s.criticalCount as number,
    warning: s.warningCount as number,
    notice: s.noticeCount as number,
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(iso: string) => new Date(iso).toLocaleDateString()} tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
          />
          <Legend />
          <Line type="monotone" dataKey="critical" name="Critical" stroke={COLORS.critical} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="warning" name="Warnings" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="notice" name="Notices" stroke={COLORS.notice} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
