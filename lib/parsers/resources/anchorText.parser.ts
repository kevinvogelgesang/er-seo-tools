import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString, toNumber } from '../../utils/columnMapper';

/**
 * Parser for ScreamingFrog's all_anchor_text.csv
 * Analyzes internal link anchor text for SEO optimization opportunities.
 */
export class AnchorTextParser extends BaseParser {
  static parserKey = 'anchortext';
  static filenamePattern = 'all_anchor_text';

  // Common non-descriptive anchor text patterns
  private static NON_DESCRIPTIVE_ANCHORS = [
    'click here',
    'read more',
    'learn more',
    'more',
    'here',
    'link',
    'this',
    'page',
    'click',
    'go',
    'see more',
    'view more',
    'continue',
    'details',
    'info',
  ];

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const typeCol = this.findColumn(['Type']);
    const sourceCol = this.findColumn(['Source']);
    const destinationCol = this.findColumn(['Destination']);
    const anchorCol = this.findColumn(['Anchor', 'Anchor Text']);
    const statusCodeCol = this.findColumn(['Status Code', 'Status']);
    const followCol = this.findColumn(['Follow']);
    const linkPositionCol = this.findColumn(['Link Position', 'Position']);

    const issues: Issue[] = [];

    // Track anchor text usage
    const anchorCounts: Record<string, number> = {};
    const destinationAnchors: Record<string, Set<string>> = {};
    const emptyAnchorUrls: string[] = [];
    const nonDescriptiveUrls: string[] = [];
    let totalHyperlinks = 0;
    let followedLinks = 0;
    let nofollowedLinks = 0;

    // Link position distribution
    const positionCounts: Record<string, number> = {};

    for (const row of this.data) {
      const type = typeCol ? toString(row[typeCol]).toLowerCase() : '';

      // Only analyze hyperlinks (not images, JS, etc.)
      if (type !== 'hyperlink') continue;

      totalHyperlinks++;

      const source = sourceCol ? toString(row[sourceCol]) : '';
      const destination = destinationCol ? toString(row[destinationCol]) : '';
      const anchor = anchorCol ? toString(row[anchorCol]).trim() : '';
      const follow = followCol ? toString(row[followCol]).toLowerCase() : 'true';
      const position = linkPositionCol ? toString(row[linkPositionCol]) : 'Unknown';

      // Track follow status
      if (follow === 'true') {
        followedLinks++;
      } else {
        nofollowedLinks++;
      }

      // Track link positions
      if (position) {
        positionCounts[position] = (positionCounts[position] || 0) + 1;
      }

      // Track anchor text usage
      if (anchor) {
        const normalizedAnchor = anchor.toLowerCase();
        anchorCounts[normalizedAnchor] = (anchorCounts[normalizedAnchor] || 0) + 1;

        // Track anchors pointing to each destination
        if (destination) {
          if (!destinationAnchors[destination]) {
            destinationAnchors[destination] = new Set();
          }
          destinationAnchors[destination].add(anchor);
        }

        // Check for non-descriptive anchor text
        if (AnchorTextParser.NON_DESCRIPTIVE_ANCHORS.includes(normalizedAnchor)) {
          if (nonDescriptiveUrls.length < 50) {
            nonDescriptiveUrls.push(`${source} -> "${anchor}" -> ${destination}`);
          }
        }
      } else {
        // Empty anchor text
        if (emptyAnchorUrls.length < 50 && source) {
          emptyAnchorUrls.push(`${source} -> ${destination}`);
        }
      }
    }

    // Find most common anchor texts
    const topAnchors = Object.entries(anchorCounts)
      .filter(([anchor]) => anchor.length > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([anchor, count]) => ({ anchor, count }));

    // Find pages with varied anchor text (good for SEO)
    const pagesWithVariedAnchors: Array<{ url: string; uniqueAnchors: number }> = [];
    const pagesWithSingleAnchor: string[] = [];

    for (const [url, anchors] of Object.entries(destinationAnchors)) {
      if (anchors.size >= 3) {
        pagesWithVariedAnchors.push({ url, uniqueAnchors: anchors.size });
      } else if (anchors.size === 1) {
        pagesWithSingleAnchor.push(url);
      }
    }

    // Sort by unique anchor count
    pagesWithVariedAnchors.sort((a, b) => b.uniqueAnchors - a.uniqueAnchors);

    // Create issues
    if (emptyAnchorUrls.length > 0) {
      issues.push({
        type: 'empty_anchor_text',
        severity: 'warning',
        count: emptyAnchorUrls.length,
        description: `${emptyAnchorUrls.length} internal links with empty anchor text`,
        urls: emptyAnchorUrls.slice(0, 30),
      });
    }

    if (nonDescriptiveUrls.length > 0) {
      issues.push({
        type: 'non_descriptive_anchor_text',
        severity: 'notice',
        count: nonDescriptiveUrls.length,
        description: `${nonDescriptiveUrls.length} internal links with non-descriptive anchor text (e.g., "click here", "read more")`,
        urls: nonDescriptiveUrls.slice(0, 30),
      });
    }

    // Pages receiving links with only one anchor variation
    if (pagesWithSingleAnchor.length > 10) {
      issues.push({
        type: 'single_anchor_variation',
        severity: 'notice',
        count: pagesWithSingleAnchor.length,
        description: `${pagesWithSingleAnchor.length} pages receive internal links with only one anchor text variation. Consider diversifying anchor text.`,
        urls: pagesWithSingleAnchor.slice(0, 30),
      });
    }

    return {
      total_hyperlinks: totalHyperlinks,
      followed_links: followedLinks,
      nofollowed_links: nofollowedLinks,
      unique_anchors: Object.keys(anchorCounts).length,
      top_anchors: topAnchors,
      link_positions: positionCounts,
      pages_with_varied_anchors: pagesWithVariedAnchors.slice(0, 20),
      stats: {
        total_hyperlinks: totalHyperlinks,
        unique_anchor_texts: Object.keys(anchorCounts).length,
        empty_anchors: emptyAnchorUrls.length,
        non_descriptive_anchors: nonDescriptiveUrls.length,
        followed_percentage: totalHyperlinks > 0
          ? Math.round((followedLinks / totalHyperlinks) * 100)
          : 0,
      },
      issues,
    };
  }
}
