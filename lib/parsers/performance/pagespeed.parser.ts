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

    // LCP (Largest Contentful Paint)
    if (lcpCol) {
      let totalLcp = 0;
      let lcpCount = 0;
      let goodCount = 0;
      let needsImprovementCount = 0;
      let poorCount = 0;
      const poorUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const lcp = toNumber(this.data[i][lcpCol]);
        if (lcp !== null) {
          totalLcp += lcp;
          lcpCount++;

          if (lcp <= PageSpeedParser.LCP_GOOD) {
            goodCount++;
          } else if (lcp <= PageSpeedParser.LCP_POOR) {
            needsImprovementCount++;
          } else {
            poorCount++;
            if (addressCol && poorUrls.length < 20) {
              poorUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (lcpCount > 0) {
        coreWebVitals.lcp = {
          avg_ms: Math.round(totalLcp / lcpCount),
          good: goodCount,
          needs_improvement: needsImprovementCount,
          poor: poorCount,
        };

        if (poorCount > 0) {
          issues.push({
            type: 'poor_lcp',
            severity: 'warning',
            count: poorCount,
            description: `${poorCount} pages with poor LCP (> 4s)`,
            urls: poorUrls,
          });
        }
      }
    }

    // FID (First Input Delay) / INP
    if (fidCol) {
      let totalFid = 0;
      let fidCount = 0;
      let goodCount = 0;
      let needsImprovementCount = 0;
      let poorCount = 0;
      const poorUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const fid = toNumber(this.data[i][fidCol]);
        if (fid !== null) {
          totalFid += fid;
          fidCount++;

          if (fid <= PageSpeedParser.FID_GOOD) {
            goodCount++;
          } else if (fid <= PageSpeedParser.FID_POOR) {
            needsImprovementCount++;
          } else {
            poorCount++;
            if (addressCol && poorUrls.length < 20) {
              poorUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (fidCount > 0) {
        coreWebVitals.fid = {
          avg_ms: Math.round(totalFid / fidCount),
          good: goodCount,
          needs_improvement: needsImprovementCount,
          poor: poorCount,
        };

        if (poorCount > 0) {
          issues.push({
            type: 'poor_fid',
            severity: 'warning',
            count: poorCount,
            description: `${poorCount} pages with poor FID/INP (> 300ms)`,
            urls: poorUrls,
          });
        }
      }
    }

    // CLS (Cumulative Layout Shift)
    if (clsCol) {
      let totalCls = 0;
      let clsCount = 0;
      let goodCount = 0;
      let needsImprovementCount = 0;
      let poorCount = 0;
      const poorUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const cls = toNumber(this.data[i][clsCol]);
        if (cls !== null) {
          totalCls += cls;
          clsCount++;

          if (cls <= PageSpeedParser.CLS_GOOD) {
            goodCount++;
          } else if (cls <= PageSpeedParser.CLS_POOR) {
            needsImprovementCount++;
          } else {
            poorCount++;
            if (addressCol && poorUrls.length < 20) {
              poorUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (clsCount > 0) {
        coreWebVitals.cls = {
          avg: Math.round((totalCls / clsCount) * 1000) / 1000,
          good: goodCount,
          needs_improvement: needsImprovementCount,
          poor: poorCount,
        };

        if (poorCount > 0) {
          issues.push({
            type: 'poor_cls',
            severity: 'warning',
            count: poorCount,
            description: `${poorCount} pages with poor CLS (> 0.25)`,
            urls: poorUrls,
          });
        }
      }
    }

    // Overall Performance Score
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
