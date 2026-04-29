// lib/relative-time.ts
// Pure date formatters used by the RelativeTime component. Kept as a
// separate module so its branching logic can be unit-tested without
// rendering React.

export function formatRelativeTime(value: Date | null, now: Date): string | null {
  if (value == null) return null;
  const deltaMs = now.getTime() - value.getTime();
  // Future timestamps (clock skew, etc.) — treat as "just now".
  if (deltaMs < 0) return 'just now';

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;

  // Older than a week — fall back to absolute date.
  return formatAbsoluteTime(value)!;
}

export function formatAbsoluteTime(value: Date | null): string | null {
  if (value == null) return null;
  return value.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
