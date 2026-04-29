'use client';

// app/pillar-analysis/[id]/components/RelativeTime.tsx
//
// Renders a timestamp like "Updated 3 hours ago" with the absolute time
// available on hover via the `title` attribute.
//
// Hydration safety: returns `null` from the FIRST render (server and
// initial client render). After the component mounts, useEffect sets a
// state flag and the next render emits the formatted strings in the
// user's local timezone. Because the server never produces a localized
// string, there is no string for the client to mismatch against.

import { useEffect, useState } from 'react';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';

interface Props {
  value: Date | string | null;
  className?: string;
}

export function RelativeTime({ value, className }: Props) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return null;
  if (value == null) return null;

  const date = typeof value === 'string' ? new Date(value) : value;
  const relative = formatRelativeTime(date, now);
  const absolute = formatAbsoluteTime(date);
  if (relative == null || absolute == null) return null;

  return (
    <span className={className} title={absolute}>
      {relative}
    </span>
  );
}
