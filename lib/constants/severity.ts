export type Severity = 'critical' | 'warning' | 'notice';

export const SEVERITY_BADGE_COLORS: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  notice: 'bg-blue-100 text-blue-800',
};
