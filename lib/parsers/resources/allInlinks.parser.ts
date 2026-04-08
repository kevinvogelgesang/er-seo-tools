import { BaseParser } from '../base.parser';
import { LinkAnalysis } from '../../types';
import { toString } from '../../utils/columnMapper';

const NON_DESCRIPTIVE_ANCHORS = new Set([
  'click here',
  'here',
  'read more',
  'learn more',
  'more',
  'link',
  'this',
  'page',
  'website',
  'www',
  '',
]);

const TOP_N = 20;

export class AllInlinksParser extends BaseParser {
  static filenamePattern = 'all_inlinks';
  static displayName = 'All Inlinks';

  parse(): { link_analysis: LinkAnalysis } {
    const zero: LinkAnalysis = {
      total_internal_links: 0,
      nofollow_ratio_pct: 0,
      non_descriptive_anchor_pct: 0,
      top_linked_pages: [],
      top_anchor_texts: [],
    };

    if (this.isEmpty) return { link_analysis: zero };

    const typeCol = this.findColumn(['Type', 'type']);
    const followCol = this.findColumn(['Follow', 'follow']);
    const destinationCol = this.findColumn(['Destination', 'destination']);
    const anchorCol = this.findColumn(['Anchor', 'anchor']);

    // Aggregate maps — no row arrays stored
    const destinationCounts = new Map<string, number>();
    const anchorCounts = new Map<string, number>();

    let totalHyperlinks = 0;
    let nofollowCount = 0;
    let nonDescriptiveCount = 0;

    for (const row of this.data) {
      const type = toString(typeCol ? row[typeCol] : null);
      if (type !== 'Hyperlink') continue;

      totalHyperlinks++;

      const follow = toString(followCol ? row[followCol] : null);
      if (follow === 'false') nofollowCount++;

      const destination = toString(destinationCol ? row[destinationCol] : null);
      if (destination) {
        destinationCounts.set(destination, (destinationCounts.get(destination) ?? 0) + 1);
      }

      const anchor = toString(anchorCol ? row[anchorCol] : null) ?? '';
      anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);

      if (NON_DESCRIPTIVE_ANCHORS.has(anchor.toLowerCase())) {
        nonDescriptiveCount++;
      }
    }

    if (totalHyperlinks === 0) return { link_analysis: zero };

    const nofollow_ratio_pct = Math.round((nofollowCount / totalHyperlinks) * 1000) / 10;
    const non_descriptive_anchor_pct = Math.round((nonDescriptiveCount / totalHyperlinks) * 1000) / 10;

    const top_linked_pages = [...destinationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([url, inlink_count]) => ({ url, inlink_count }));

    const top_anchor_texts = [...anchorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([anchor_text, count]) => ({
        anchor_text,
        count,
        is_descriptive: !NON_DESCRIPTIVE_ANCHORS.has(anchor_text.toLowerCase()),
      }));

    return {
      link_analysis: {
        total_internal_links: totalHyperlinks,
        nofollow_ratio_pct,
        non_descriptive_anchor_pct,
        top_linked_pages,
        top_anchor_texts,
      },
    };
  }
}
