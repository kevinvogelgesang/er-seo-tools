import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toString } from '../../utils/columnMapper';

export class AnchorTextParser extends StreamingParser {
  static parserKey = 'anchortext';
  static filenamePattern = 'all_anchor_text';

  private static NON_DESCRIPTIVE_ANCHORS = [
    'click here', 'read more', 'learn more', 'more', 'here', 'link', 'this',
    'page', 'click', 'go', 'see more', 'view more', 'continue', 'details', 'info',
  ];

  private typeCol: string | null = null;
  private sourceCol: string | null = null;
  private destinationCol: string | null = null;
  private anchorCol: string | null = null;
  private followCol: string | null = null;
  private linkPositionCol: string | null = null;

  private anchorCounts: Record<string, number> = {};
  private destinationAnchors: Record<string, Set<string>> = {};
  private emptyAnchorUrls: string[] = [];
  private nonDescriptiveUrls: string[] = [];
  private positionCounts: Record<string, number> = {};
  private totalHyperlinks = 0;
  private followedLinks = 0;
  private nofollowedLinks = 0;

  protected onHeaders(): void {
    this.typeCol = this.findColumn(['Type']);
    this.sourceCol = this.findColumn(['Source']);
    this.destinationCol = this.findColumn(['Destination']);
    this.anchorCol = this.findColumn(['Anchor', 'Anchor Text']);
    this.followCol = this.findColumn(['Follow']);
    this.linkPositionCol = this.findColumn(['Link Position', 'Position']);
  }

  protected consumeRow(row: CSVRow): void {
    const type = this.typeCol ? toString(row[this.typeCol]).toLowerCase() : '';
    if (type !== 'hyperlink') return;
    this.totalHyperlinks++;

    const source = this.sourceCol ? toString(row[this.sourceCol]) : '';
    const destination = this.destinationCol ? toString(row[this.destinationCol]) : '';
    const anchor = this.anchorCol ? toString(row[this.anchorCol]).trim() : '';
    const follow = this.followCol ? toString(row[this.followCol]).toLowerCase() : 'true';
    const position = this.linkPositionCol ? toString(row[this.linkPositionCol]) : 'Unknown';

    if (follow === 'true') this.followedLinks++; else this.nofollowedLinks++;
    if (position) this.positionCounts[position] = (this.positionCounts[position] || 0) + 1;

    if (anchor) {
      const normalizedAnchor = anchor.toLowerCase();
      this.anchorCounts[normalizedAnchor] = (this.anchorCounts[normalizedAnchor] || 0) + 1;
      if (destination) {
        if (!this.destinationAnchors[destination]) this.destinationAnchors[destination] = new Set();
        this.destinationAnchors[destination].add(anchor);
      }
      if (AnchorTextParser.NON_DESCRIPTIVE_ANCHORS.includes(normalizedAnchor)) {
        if (this.nonDescriptiveUrls.length < 50) {
          this.nonDescriptiveUrls.push(`${source} -> "${anchor}" -> ${destination}`);
        }
      }
    } else {
      if (this.emptyAnchorUrls.length < 50 && source) {
        this.emptyAnchorUrls.push(`${source} -> ${destination}`);
      }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];

    const topAnchors = Object.entries(this.anchorCounts)
      .filter(([anchor]) => anchor.length > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([anchor, count]) => ({ anchor, count }));

    const pagesWithVariedAnchors: Array<{ url: string; uniqueAnchors: number }> = [];
    const pagesWithSingleAnchor: string[] = [];
    for (const [url, anchors] of Object.entries(this.destinationAnchors)) {
      if (anchors.size >= 3) pagesWithVariedAnchors.push({ url, uniqueAnchors: anchors.size });
      else if (anchors.size === 1) pagesWithSingleAnchor.push(url);
    }
    pagesWithVariedAnchors.sort((a, b) => b.uniqueAnchors - a.uniqueAnchors);

    if (this.emptyAnchorUrls.length > 0) {
      issues.push({
        type: 'empty_anchor_text', severity: 'warning', count: this.emptyAnchorUrls.length,
        description: `${this.emptyAnchorUrls.length} internal links with empty anchor text`,
        urls: this.emptyAnchorUrls.slice(0, 30),
      });
    }
    if (this.nonDescriptiveUrls.length > 0) {
      issues.push({
        type: 'non_descriptive_anchor_text', severity: 'notice', count: this.nonDescriptiveUrls.length,
        description: `${this.nonDescriptiveUrls.length} internal links with non-descriptive anchor text (e.g., "click here", "read more")`,
        urls: this.nonDescriptiveUrls.slice(0, 30),
      });
    }
    if (pagesWithSingleAnchor.length > 10) {
      issues.push({
        type: 'single_anchor_variation', severity: 'notice', count: pagesWithSingleAnchor.length,
        description: `${pagesWithSingleAnchor.length} pages receive internal links with only one anchor text variation. Consider diversifying anchor text.`,
        urls: pagesWithSingleAnchor.slice(0, 30),
      });
    }

    return {
      total_hyperlinks: this.totalHyperlinks,
      followed_links: this.followedLinks,
      nofollowed_links: this.nofollowedLinks,
      unique_anchors: Object.keys(this.anchorCounts).length,
      top_anchors: topAnchors,
      link_positions: this.positionCounts,
      pages_with_varied_anchors: pagesWithVariedAnchors.slice(0, 20),
      stats: {
        total_hyperlinks: this.totalHyperlinks,
        unique_anchor_texts: Object.keys(this.anchorCounts).length,
        empty_anchors: this.emptyAnchorUrls.length,
        non_descriptive_anchors: this.nonDescriptiveUrls.length,
        followed_percentage: this.totalHyperlinks > 0
          ? Math.round((this.followedLinks / this.totalHyperlinks) * 100) : 0,
      },
      issues,
    };
  }
}
