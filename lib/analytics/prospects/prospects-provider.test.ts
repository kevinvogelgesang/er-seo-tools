/**
 * DB-backed tests for fetchProspects + crmAdapter.
 *
 * Run with:
 *   DATABASE_URL="file:./local-dev.db" npx vitest run lib/analytics/prospects/prospects-provider.test.ts
 *
 * Cleanup hygiene:
 *   - All Client rows created here use the PREFIX '__prosp__' so deletes are scoped.
 *   - afterEach cleans ProspectsEntry rows via clientId FK scope, then Client rows.
 *   - process.env.CRM_API_BASE is saved/restored in any test that sets it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { fetchProspects } from './prospects-provider';
import { crmAdapter } from './crm-adapter';

// ─── Constants ───────────────────────────────────────────────────────────────

const PREFIX = '__prosp__';

/** Canonical midnight-UTC period used across tests */
const PERIOD = {
  start: new Date(Date.UTC(2026, 4, 1)),  // 2026-05-01T00:00:00Z
  end:   new Date(Date.UTC(2026, 4, 31)), // 2026-05-31T00:00:00Z
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a Client row scoped to this test file's prefix */
async function makeClient(tag: string, crmClientRef: string | null = null) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}`, crmClientRef },
  });
}

/** Scope cleanup to rows we own */
async function clear() {
  // ProspectsEntry rows cascade-delete when Client is deleted, but we delete
  // them explicitly first to stay safe across schema variations.
  await prisma.prospectsEntry.deleteMany({
    where: { client: { name: { startsWith: PREFIX } } },
  });
  await prisma.client.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

afterEach(clear);

// ─── CRM adapter stub ────────────────────────────────────────────────────────

describe('crmAdapter.fetch (stub)', () => {
  it('always returns {ok:false, reason:"unmapped"} with "not configured" message', async () => {
    const result = await crmAdapter.fetch('any-ref', PERIOD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unmapped');
      expect(result.message).toMatch(/not configured/i);
    }
  });
});

// ─── fetchProspects: no CRM, ProspectsEntry exists ───────────────────────────

describe('fetchProspects — manual DB path', () => {
  it('returns {ok:true, data:{total, organic}} when a ProspectsEntry exists for the exact window', async () => {
    const client = await makeClient('entry-exists');

    await prisma.prospectsEntry.create({
      data: {
        clientId: client.id,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        total: 320,
        organic: 180,
      },
    });

    const result = await fetchProspects(
      { id: client.id, crmClientRef: null },
      PERIOD,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(320);
      expect(result.data.organic).toBe(180);
    }
  });

  it('returns {ok:true, data:{total, organic:null}} when organic is null', async () => {
    const client = await makeClient('entry-no-organic');

    await prisma.prospectsEntry.create({
      data: {
        clientId: client.id,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        total: 100,
        organic: null,
      },
    });

    const result = await fetchProspects(
      { id: client.id, crmClientRef: null },
      PERIOD,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(100);
      expect(result.data.organic).toBeNull();
    }
  });
});

// ─── fetchProspects: no CRM, no entry ────────────────────────────────────────

describe('fetchProspects — unmapped fallback', () => {
  it('returns {ok:false, reason:"unmapped"} when no CRM and no ProspectsEntry', async () => {
    const client = await makeClient('no-entry');

    const result = await fetchProspects(
      { id: client.id, crmClientRef: null },
      PERIOD,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unmapped');
    }
  });
});

// ─── fetchProspects: CRM short-circuit ───────────────────────────────────────

describe('fetchProspects — CRM short-circuit', () => {
  it('returns CRM result immediately without falling back to DB when CRM returns ok:true', async () => {
    const origBase = process.env.CRM_API_BASE;
    process.env.CRM_API_BASE = 'https://fake-crm.example.com';

    try {
      // Spy on crmAdapter.fetch to return ok:true with distinct marker values
      const crmSpy = vi.spyOn(crmAdapter, 'fetch').mockResolvedValueOnce({
        ok: true,
        data: { total: 999, organic: 777 },
      });

      // No DB entry exists for this client — if DB were consulted, result would
      // be {ok:false, reason:'unmapped'}, not {ok:true, data:{total:999,...}}.
      const client = await makeClient('crm-shortcircuit', 'crm-ref-abc');

      const result = await fetchProspects(
        { id: client.id, crmClientRef: 'crm-ref-abc' },
        PERIOD,
      );

      // Should return the CRM data (proves DB was not consulted — no entry exists)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(999);
        expect(result.data.organic).toBe(777);
      }

      // CRM adapter was called once with the correct arguments
      expect(crmSpy).toHaveBeenCalledTimes(1);
      expect(crmSpy).toHaveBeenCalledWith('crm-ref-abc', PERIOD);
    } finally {
      vi.restoreAllMocks();
      if (origBase === undefined) {
        delete process.env.CRM_API_BASE;
      } else {
        process.env.CRM_API_BASE = origBase;
      }
    }
  });

  it('falls through to DB when CRM returns ok:false (not-ok CRM does not short-circuit)', async () => {
    const origBase = process.env.CRM_API_BASE;
    process.env.CRM_API_BASE = 'https://fake-crm.example.com';

    try {
      // CRM returns not-ok
      vi.spyOn(crmAdapter, 'fetch').mockResolvedValueOnce({
        ok: false,
        reason: 'error',
        message: 'simulated CRM failure',
      });

      const client = await makeClient('crm-fallthrough', 'crm-ref-xyz');

      // Create a DB entry so we can verify the fallthrough
      await prisma.prospectsEntry.create({
        data: {
          clientId: client.id,
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          total: 50,
          organic: 25,
        },
      });

      const result = await fetchProspects(
        { id: client.id, crmClientRef: 'crm-ref-xyz' },
        PERIOD,
      );

      // Should have fallen through to DB
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total).toBe(50);
        expect(result.data.organic).toBe(25);
      }
    } finally {
      vi.restoreAllMocks();
      if (origBase === undefined) {
        delete process.env.CRM_API_BASE;
      } else {
        process.env.CRM_API_BASE = origBase;
      }
    }
  });

  it('skips CRM path when crmClientRef is null (even if CRM_API_BASE is set)', async () => {
    const origBase = process.env.CRM_API_BASE;
    process.env.CRM_API_BASE = 'https://fake-crm.example.com';

    try {
      const crmSpy = vi.spyOn(crmAdapter, 'fetch');

      const client = await makeClient('crm-null-ref', null);

      const result = await fetchProspects(
        { id: client.id, crmClientRef: null },
        PERIOD,
      );

      // No entry and no CRM — should be unmapped
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('unmapped');
      }

      // CRM adapter should NOT have been called when crmClientRef is null
      expect(crmSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      if (origBase === undefined) {
        delete process.env.CRM_API_BASE;
      } else {
        process.env.CRM_API_BASE = origBase;
      }
    }
  });
});
