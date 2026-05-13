import { AggregatedResult } from '@/lib/types';

export function parseStoredResult(raw: string): AggregatedResult | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AggregatedResult;
  } catch {
    return null;
  }
}
