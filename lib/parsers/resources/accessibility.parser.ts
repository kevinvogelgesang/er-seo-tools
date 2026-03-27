import { BaseParser } from '../base.parser';
import { AccessibilityResult, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

/**
 * Parser for Screaming Frog accessibility audit exports (accessibility.csv).
 * Screaming Frog runs WCAG accessibility checks and exports per-page violations.
 * Typical columns: Address, Issues, Errors, Alerts, Features
 */
export class AccessibilityParser extends BaseParser {
  static filenamePattern = 'accessibility';

  parse(): AccessibilityResult {
    if (this.isEmpty) {
      return this.getEmptyResult();
    }

    // Build column references — handle variant column names across SF versions
    const addressCol = this.findColumn(['Address', 'URL']);
    const issuesCol = this.findColumn(['Issues', 'Total Issues']);
    const errorsCol = this.findColumn(['Errors', 'WCAG Errors', 'Accessibility Errors']);
    const alertsCol = this.findColumn(['Alerts', 'Warnings', 'WCAG Warnings']);
    const featuresCol = this.findColumn(['Features', 'Accessibility Features']);

    const issues: Issue[] = [];
    let totalPages = this.length;
    let pagesWithErrors = 0;
    let pagesWithAlerts = 0;
    let totalErrors = 0;
    let totalAlerts = 0;

    const errorUrls: string[] = [];
    const alertUrls: string[] = [];

    for (let i = 0; i < this.data.length; i++) {
      const row = this.data[i];
      const address = addressCol ? toString(row[addressCol]) : '';

      // Count errors per page
      if (errorsCol) {
        const errorCount = toNumber(row[errorsCol]);
        if (errorCount !== null && errorCount > 0) {
          pagesWithErrors++;
          totalErrors += errorCount;
          if (address && errorUrls.length < 30) {
            errorUrls.push(address);
          }
        }
      }

      // Count alerts per page
      if (alertsCol) {
        const alertCount = toNumber(row[alertsCol]);
        if (alertCount !== null && alertCount > 0) {
          pagesWithAlerts++;
          totalAlerts += alertCount;
          if (address && alertUrls.length < 30) {
            alertUrls.push(address);
          }
        }
      }
    }

    const errorRate = totalPages > 0 ? pagesWithErrors / totalPages : 0;

    // Generate issues
    if (pagesWithErrors > 0) {
      issues.push({
        type: 'accessibility_errors',
        severity: 'critical',
        count: pagesWithErrors,
        description: `${pagesWithErrors} pages have critical WCAG accessibility errors (${totalErrors} total errors)`,
        urls: errorUrls,
      });
    }

    if (pagesWithAlerts > 0) {
      issues.push({
        type: 'accessibility_alerts',
        severity: 'warning',
        count: pagesWithAlerts,
        description: `${pagesWithAlerts} pages have WCAG accessibility warnings (${totalAlerts} total alerts)`,
        urls: alertUrls,
      });
    }

    return {
      totalPages,
      pagesWithErrors,
      pagesWithAlerts,
      totalErrors,
      totalAlerts,
      errorRate: Math.round(errorRate * 1000) / 10, // percentage, 1 decimal place
      issues,
    };
  }

  private getEmptyResult(): AccessibilityResult {
    return {
      totalPages: 0,
      pagesWithErrors: 0,
      pagesWithAlerts: 0,
      totalErrors: 0,
      totalAlerts: 0,
      errorRate: 0,
      issues: [],
    };
  }
}
