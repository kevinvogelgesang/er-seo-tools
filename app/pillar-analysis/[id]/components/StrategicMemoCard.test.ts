import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// MemoPoller is a 'use client' component that calls useRouter() at render time.
// We mock next/navigation so renderToStaticMarkup can SSR the tree without a
// live App Router context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { StrategicMemoCard } from './StrategicMemoCard';

function render(props: { aiNarrative: string | null; narrativeUpdatedAt: Date | null; sessionId: string }) {
  return renderToStaticMarkup(createElement(StrategicMemoCard, props));
}

describe('StrategicMemoCard', () => {
  it('null state renders the instructional hint', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/Strategic Memo/);
    expect(html).toMatch(/Strategic memo not yet generated/);
    expect(html).toMatch(/Copy Claude Prompt/);
  });

  it('null state does not render markdown', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).not.toMatch(/<h2/);
  });

  it('has-memo state renders the markdown', () => {
    const html = render({
      aiNarrative: '## 1. Bottom line\n\nWorth it.',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/<h2[^>]*>1\. Bottom line<\/h2>/);
    expect(html).toMatch(/Worth it\./);
  });

  it('has-memo state does not render the null-state hint', () => {
    const html = render({
      aiNarrative: '## 1. Bottom line\n\nWorth it.',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
      sessionId: 'sess_x',
    });
    expect(html).not.toMatch(/Strategic memo not yet generated/);
  });

  it('renders the section anchor id="memo"', () => {
    const html = render({
      aiNarrative: null,
      narrativeUpdatedAt: null,
      sessionId: 'sess_x',
    });
    expect(html).toMatch(/id="memo"/);
  });
});
