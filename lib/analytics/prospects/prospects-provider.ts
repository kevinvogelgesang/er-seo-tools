/**
 * Prospects provider — resolves ProspectsBundle for a client + date window.
 *
 * Precedence (implemented exactly per task brief):
 *   1. CRM path: if client.crmClientRef is set AND process.env.CRM_API_BASE is
 *      present → call crmAdapter.fetch(crmClientRef, period). If it returns
 *      {ok:true}, short-circuit and return it (manual DB lookup is skipped).
 *   2. Manual DB path: prisma.prospectsEntry.findUnique on the exact
 *      clientId + periodStart + periodEnd triple → if found, map to {ok:true}.
 *   3. Not found: {ok:false, reason:'unmapped'}.
 */

import { prisma } from '@/lib/db';
import { crmAdapter } from './crm-adapter';
import type { DateWindow } from '../dates';
import type { SourceResult, ProspectsBundle } from '../types';

/**
 * Fetch a ProspectsBundle for the given client and period window.
 *
 * @param client  Minimal client shape: numeric id + optional CRM reference.
 * @param period  Canonical midnight-UTC DateWindow from dates.ts.
 */
export async function fetchProspects(
  client: { id: number; crmClientRef: string | null },
  period: DateWindow,
): Promise<SourceResult<ProspectsBundle>> {
  // ── 1. CRM path ─────────────────────────────────────────────────────────────
  if (client.crmClientRef !== null && process.env.CRM_API_BASE) {
    const crmResult = await crmAdapter.fetch(client.crmClientRef, period);
    if (crmResult.ok) {
      return crmResult;
    }
    // CRM returned not-ok — fall through to manual DB lookup
  }

  // ── 2. Manual DB path ────────────────────────────────────────────────────────
  const entry = await prisma.prospectsEntry.findUnique({
    where: {
      clientId_periodStart_periodEnd: {
        clientId: client.id,
        periodStart: period.start,
        periodEnd: period.end,
      },
    },
  });

  if (entry !== null) {
    return {
      ok: true,
      data: {
        total: entry.total,
        organic: entry.organic,
      },
    };
  }

  // ── 3. Not found ─────────────────────────────────────────────────────────────
  return { ok: false, reason: 'unmapped' };
}
