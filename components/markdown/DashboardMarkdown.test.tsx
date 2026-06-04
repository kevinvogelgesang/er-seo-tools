// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DashboardMarkdown } from './DashboardMarkdown';

describe('DashboardMarkdown', () => {
  it('renders a GFM pipe table as a real <table> with header and body cells', () => {
    const md = [
      '| Type | Count |',
      '|------|-------|',
      '| Exact duplicate pages | 0 |',
      '| Duplicate title tags | 2 groups |',
    ].join('\n');
    const { container } = render(<DashboardMarkdown source={md} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelectorAll('thead th').length).toBe(2);
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
    expect(container.textContent).toContain('Duplicate title tags');
  });

  it('does NOT render raw HTML (no rehype-raw)', () => {
    const { container } = render(<DashboardMarkdown source={'<script>alert(1)</script> and <b>bold</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });
});
