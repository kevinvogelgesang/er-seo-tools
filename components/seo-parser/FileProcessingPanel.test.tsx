// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { FileProcessingPanel } from './FileProcessingPanel';
import type { FileReport } from '@/lib/types';

afterEach(cleanup);

const legacy = { filesProcessed: 4, parsersUsed: 3, totalParsers: 40 };

describe('FileProcessingPanel', () => {
  it('renders nothing for archived results', () => {
    const { container } = render(<FileProcessingPanel reports={undefined} archived legacy={legacy} />);
    expect(container.textContent).toBe('');
  });

  it('falls back to the legacy summary when file_reports is absent', () => {
    const { container } = render(<FileProcessingPanel reports={undefined} legacy={legacy} />);
    expect(container.textContent).toContain('4 files');
    expect(container.textContent).toContain('3');
  });

  it('shows a core-failure banner when a core export failed', () => {
    const reports: FileReport[] = [
      { filename: 'internal_all.csv', status: 'failed', severity: 'core', error: 'boom' },
      { filename: 'response_codes.csv', status: 'parsed', severity: 'info', parser: 'responsecodes' },
    ];
    const { container } = render(<FileProcessingPanel reports={reports} legacy={legacy} />);
    expect(container.textContent).toContain('internal_all.csv');
    expect(container.textContent?.toLowerCase()).toContain('unreliable');
  });

  it('summarizes buckets and does not show the banner without a core failure', () => {
    const reports: FileReport[] = [
      { filename: 'a.csv', status: 'parsed', severity: 'info', parser: 'x' },
      { filename: 'b.csv', status: 'failed', severity: 'normal', error: 'oops' },
      { filename: 'c.csv', status: 'unmatched', severity: 'info' },
      { filename: 'notes.txt', status: 'skipped', severity: 'info' },
    ];
    const { container } = render(<FileProcessingPanel reports={reports} legacy={legacy} />);
    expect(container.textContent).toContain('1 parsed');
    expect(container.textContent).toContain('1 failed');
    expect(container.textContent?.toLowerCase()).not.toContain('unreliable');
  });
});
