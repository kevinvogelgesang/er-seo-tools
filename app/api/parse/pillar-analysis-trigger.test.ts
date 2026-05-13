import { beforeEach, describe, expect, it, vi } from 'vitest';

const runPillarAnalysisForSessionMock = vi.fn();

vi.mock('@/lib/services/pillarAnalysis/runFromSession', () => ({
  runPillarAnalysisForSession: (...args: unknown[]) => runPillarAnalysisForSessionMock(...args),
}));

import { triggerPillarAnalysis } from './pillar-analysis-trigger';

describe('triggerPillarAnalysis', () => {
  beforeEach(() => {
    runPillarAnalysisForSessionMock.mockReset().mockResolvedValue({ id: 'pa-1', status: 'complete' });
    vi.unstubAllGlobals();
  });

  it('runs pillar analysis directly instead of fetching the authenticated API route', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await triggerPillarAnalysis('session-1');

    expect(runPillarAnalysisForSessionMock).toHaveBeenCalledWith('session-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs direct runner failures without throwing', async () => {
    const error = new Error('analysis failed');
    runPillarAnalysisForSessionMock.mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(triggerPillarAnalysis('session-1')).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith('[pillar-analysis] trigger error', error);
    consoleSpy.mockRestore();
  });
});
