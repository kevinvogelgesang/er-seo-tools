import { beforeEach, describe, expect, it, vi } from 'vitest';

const siteFindUniqueMock = vi.fn();
const siteDeleteMock = vi.fn();
const adaFindManyMock = vi.fn();
const deleteAuditArtifactsMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    siteAudit: {
      findUnique: (...args: unknown[]) => siteFindUniqueMock(...args),
      delete: (...args: unknown[]) => siteDeleteMock(...args),
    },
    adaAudit: {
      findMany: (...args: unknown[]) => adaFindManyMock(...args),
    },
  },
}));

vi.mock('@/lib/ada-audit/screenshot-helpers', () => ({
  deleteAuditArtifacts: (...args: unknown[]) => deleteAuditArtifactsMock(...args),
}));

import { DELETE } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/site-audit/[id]', () => {
  beforeEach(() => {
    siteFindUniqueMock.mockReset().mockResolvedValue({ id: 'site-1' });
    siteDeleteMock.mockReset().mockResolvedValue({});
    adaFindManyMock.mockReset().mockResolvedValue([{ id: 'child-1' }, { id: 'child-2' }]);
    deleteAuditArtifactsMock.mockReset()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('disk cleanup failed'));
  });

  it('returns ok after cascade deleting the DB row even when a child artifact cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await DELETE({} as never, makeParams('site-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(adaFindManyMock).toHaveBeenCalledWith({
      where: { siteAuditId: 'site-1' },
      select: { id: true },
    });
    expect(siteDeleteMock).toHaveBeenCalledWith({ where: { id: 'site-1' } });
    expect(deleteAuditArtifactsMock).toHaveBeenCalledWith('child-1');
    expect(deleteAuditArtifactsMock).toHaveBeenCalledWith('child-2');

    warn.mockRestore();
  });
});
