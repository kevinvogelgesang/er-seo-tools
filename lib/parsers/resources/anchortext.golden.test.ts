// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { AnchorTextParser } from './anchorText.parser';
import { parseString } from '../test-parse-helper';

// Rows: only 'hyperlink' Type counts. Includes a numeric-looking anchor "123",
// a tie between two anchors, an empty anchor, and a non-descriptive anchor.
const rows = [
  'Type,Source,Destination,Anchor,Status Code,Follow,Link Position',
  'hyperlink,https://s/1,https://d/x,About,200,true,Content',
  'hyperlink,https://s/2,https://d/x,Services,200,true,Content',   // d/x now 2 anchors
  'hyperlink,https://s/3,https://d/x,Contact,200,true,Navigation', // d/x now 3 anchors → varied
  'hyperlink,https://s/4,https://d/y,About,200,false,Content',     // "About" count → 2 (tie w/ others at 1? see below)
  'hyperlink,https://s/5,https://d/z,123,200,true,Footer',         // numeric-looking anchor
  'hyperlink,https://s/6,https://d/z,click here,200,true,Footer',  // non-descriptive
  'hyperlink,https://s/7,https://d/w,,200,true,Content',           // empty anchor
  'image,https://s/8,https://d/v,ignored,200,true,Content',        // NOT hyperlink → skipped
];

// Captured verbatim from a single `npx tsx` run of the current (pre-refactor)
// parser over `rows` above. See task-1-brief.md Step 6 for the capture script.
const CAPTURED_ANCHOR_OUTPUT = {
  total_hyperlinks: 7,
  followed_links: 6,
  nofollowed_links: 1,
  unique_anchors: 5,
  top_anchors: [
    { anchor: 'about', count: 2 },
    { anchor: '123', count: 1 },
    { anchor: 'services', count: 1 },
    { anchor: 'contact', count: 1 },
    { anchor: 'click here', count: 1 },
  ],
  link_positions: {
    Content: 4,
    Navigation: 1,
    Footer: 2,
  },
  pages_with_varied_anchors: [
    { url: 'https://d/x', uniqueAnchors: 3 },
  ],
  stats: {
    total_hyperlinks: 7,
    unique_anchor_texts: 5,
    empty_anchors: 1,
    non_descriptive_anchors: 1,
    followed_percentage: 86,
  },
  issues: [
    {
      type: 'empty_anchor_text',
      severity: 'warning',
      count: 1,
      description: '1 internal links with empty anchor text',
      urls: ['https://s/7 -> https://d/w'],
    },
    {
      type: 'non_descriptive_anchor_text',
      severity: 'notice',
      count: 1,
      description: '1 internal links with non-descriptive anchor text (e.g., "click here", "read more")',
      urls: ['https://s/6 -> "click here" -> https://d/z'],
    },
  ],
};

describe('AnchorTextParser golden', () => {
  it('exact output (tie order, numeric anchor, capped counts)', () => {
    const out = parseString(AnchorTextParser, rows.join('\n'));
    expect(out).toEqual(CAPTURED_ANCHOR_OUTPUT);
  });

  it('empty input → {}', () => {
    expect(parseString(AnchorTextParser, 'Type,Source,Destination,Anchor')).toEqual({});
  });
});
