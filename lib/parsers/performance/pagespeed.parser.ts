import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class PageSpeedParser extends BaseParser {
  static filenamePattern = 'pagespeed';

  // Core Web Vitals thresholds
  private static LCP_GOOD = 2500; // ms
  private static LCP_POOR = 4000;
  private static FID_GOOD = 100; // ms
  private static FID_POOR = 300;
  private static CLS_GOOD = 0.1;
  private static CLS_POOR = 0.25;

  private analyzeMetric(
    col: string,
    addressCol: string | null,
    goodThreshold: number,
    poorThreshold: number,
    isMs: boolean,
    issueType: string,
    poorLabel: string,
  ): { issue: Issue | null; vitals: Record<string, number> } {
    let total = 0, count = 0, good = 0, needsImprovement = 0, poor = 0;
    const poorUrls: string[] = [];

    for (let i = 0; i < this.data.length; i++) {
      const val = toNumber(this.data[i][col]);
      if (val !== null) {
        total += val;
        count++;
        if (val <= goodThreshold) {
          good++;
        } else if (val <= poorThreshold) {
          needsImprovement++;
        } else {
          poor++;
          if (addressCol && poorUrls.length < 20) {
            poorUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }
    }

    if (count === 0) return { issue: null, vitals: {} };

    const avg = total / count;
    const vitals: Record<string, number> = {
      ...(isMs ? { avg_ms: Math.round(avg) } : { avg: Math.round(avg * 1000) / 1000 }),
      good,
      needs_improvement: needsImprovement,
      poor,
    };

    const issue: Issue | null = poor > 0 ? {
      type: issueType,
      severity: 'warning',
      count: poor,
      description: `${poor} pages with poor ${poorLabel}`,
      urls: poorUrls,
    } : null;

    return { issue, vitals };
  }

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const lcpCol = this.findColumn(['LCP', 'Largest Contentful Paint', 'LCP (ms)']);
    const fidCol = this.findColumn(['FID', 'First Input Delay', 'INP', 'Interaction to Next Paint']);
    const clsCol = this.findColumn(['CLS', 'Cumulative Layout Shift']);
    const scoreCol = this.findColumn(['Performance Score', 'Score', 'Lighthouse Score']);

    const issues: Issue[] = [];
    const coreWebVitals: Record<string, Record<string, number>> = {};
    const stats: Record<string, number> = {};

    if (lcpCol) {
      const { issue, vitals } = this.analyzeMetric(
        lcpCol, addressCol, PageSpeedParser.LCP_GOOD, PageSpeedParser.LCP_POOR,
        true, 'poor_lcp', 'LCP (> 4s)',
      );
      if (Object.keys(vitals).length) coreWebVitals.lcp = vitals;
      if (issue) issues.push(issue);
    }

    if (fidCol) {
      const { issue, vitals } = this.analyzeMetric(
        fidCol, addressCol, PageSpeedParser.FID_GOOD, PageSpeedParser.FID_POOR,
        true, 'poor_fid', 'FID/INP (> 300ms)',
      );
      if (Object.keys(vitals).length) coreWebVitals.fid = vitals;
      if (issue) issues.push(issue);
    }

    if (clsCol) {
      const { issue, vitals } = this.analyzeMetric(
        clsCol, addressCol, PageSpeedParser.CLS_GOOD, PageSpeedParser.CLS_POOR,
        false, 'poor_cls', 'CLS (> 0.25)',
      );
      if (Object.keys(vitals).length) coreWebVitals.cls = vitals;
      if (issue) issues.push(issue);
    }

    // Overall Performance Score (no needs_improvement bucket — keep separate)
    if (scoreCol) {
      let totalScore = 0;
      let scoreCount = 0;
      let poorCount = 0;
      const poorUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const score = toNumber(this.data[i][scoreCol]);
        if (score !== null) {
          totalScore += score;
          scoreCount++;
          if (score < 50) {
            poorCount++;
            if (addressCol && poorUrls.length < 20) {
              poorUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (scoreCount > 0) {
        stats.avg_performance_score = Math.round(totalScore / scoreCount);
        if (poorCount > 0) {
          issues.push({
            type: 'poor_performance_score',
            severity: 'critical',
            count: poorCount,
            description: `${poorCount} pages with poor performance score (< 50)`,
            urls: poorUrls,
          });
        }
      }
    }

    return {
      total_pages: this.length,
      core_web_vitals: Object.keys(coreWebVitals).length > 0 ? coreWebVitals : undefined,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}
