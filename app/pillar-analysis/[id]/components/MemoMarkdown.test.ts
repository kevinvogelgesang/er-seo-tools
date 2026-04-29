import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MemoMarkdown } from './MemoMarkdown';

function render(source: string): string {
  return renderToStaticMarkup(createElement(MemoMarkdown, { source }));
}

describe('MemoMarkdown', () => {
  it('renders an h2 header with dashboard typography classes', () => {
    const html = render('## Section title');
    expect(html).toMatch(/<h2[^>]*class="[^"]*font-display[^"]*"[^>]*>Section title<\/h2>/);
  });

  it('renders an h3 header with dashboard typography classes', () => {
    const html = render('### Sub section');
    expect(html).toMatch(/<h3[^>]*class="[^"]*font-display[^"]*"[^>]*>Sub section<\/h3>/);
  });

  it('renders a paragraph with body classes', () => {
    const html = render('A paragraph of text.');
    expect(html).toMatch(/<p[^>]*class="[^"]*text-gray-700[^"]*"[^>]*>A paragraph of text\.<\/p>/);
  });

  it('renders an unordered list', () => {
    const html = render('- one\n- two');
    expect(html).toMatch(/<ul[^>]*class="[^"]*list-disc[^"]*"/);
    expect(html).toMatch(/<li[^>]*>one<\/li>/);
    expect(html).toMatch(/<li[^>]*>two<\/li>/);
  });

  it('renders an ordered list', () => {
    const html = render('1. first\n2. second');
    expect(html).toMatch(/<ol[^>]*class="[^"]*list-decimal[^"]*"/);
  });

  it('renders bold and italic inline marks', () => {
    const html = render('A **bold** and *italic* phrase.');
    expect(html).toMatch(/<strong[^>]*class="[^"]*font-semibold[^"]*"[^>]*>bold<\/strong>/);
    expect(html).toMatch(/<em[^>]*class="[^"]*italic[^"]*"[^>]*>italic<\/em>/);
  });

  it('escapes raw HTML rather than rendering it', () => {
    const html = render('A paragraph with <script>alert(1)</script> in it.');
    // react-markdown's default behavior is to render HTML as text (no rehype-raw).
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  it('renders a full memo skeleton with all six section headers', () => {
    const memo = [
      '## 1. Bottom line', 'Worth it.',
      '## 2. Score interpretation', 'Score 8/10.',
      '## 3. Hub recommendation', 'Nest under programs.',
      '## 4. Pillar topics', '### HVAC', '12 cluster pages.',
      '## 5. Migration sequencing', '1. Refresh posts.',
      '## 6. Caveats', '- Outdated content.',
    ].join('\n\n');
    const html = render(memo);
    expect(html).toMatch(/1\. Bottom line/);
    expect(html).toMatch(/2\. Score interpretation/);
    expect(html).toMatch(/3\. Hub recommendation/);
    expect(html).toMatch(/4\. Pillar topics/);
    expect(html).toMatch(/5\. Migration sequencing/);
    expect(html).toMatch(/6\. Caveats/);
  });
});
