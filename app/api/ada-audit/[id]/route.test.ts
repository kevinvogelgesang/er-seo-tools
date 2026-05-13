import { describe, expect, it, vi, beforeEach } from 'vitest';

const adaFindUniqueMock = vi.fn();
const adaDeleteMock = vi.fn();
const deleteAuditArtifactsMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: {
      findUnique: (...args: unknown[]) => adaFindUniqueMock(...args),
      delete: (...args: unknown[]) => adaDeleteMock(...args),
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

describe('DELETE /api/ada-audit/[id]', () => {
  beforeEach(() => {
    adaFindUniqueMock.mockReset().mockResolvedValue({ id: 'audit-1' });
    adaDeleteMock.mockReset().mockResolvedValue({});
    deleteAuditArtifactsMock.mockReset().mockRejectedValue(new Error('disk cleanup failed'));
  });

  it('returns ok after deleting the DB row even when artifact cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await DELETE({} as never, makeParams('audit-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(adaDeleteMock).toHaveBeenCalledWith({ where: { id: 'audit-1' } });
    expect(deleteAuditArtifactsMock).toHaveBeenCalledWith('audit-1');

    warn.mockRestore();
  });
});
