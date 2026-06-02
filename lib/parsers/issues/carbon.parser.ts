import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class CarbonParser extends BaseParser {
  static parserKey = 'carbon';
  static filenamePattern = 'carbon';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const co2Col = this.findColumn(['CO2 (mg)', 'CO2', 'Carbon (mg)']);
    const ratingCol = this.findColumn(['Carbon Rating', 'Rating']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    const ratingCounts: Record<string, number> = {};
    const highCarbonUrls: string[] = [];

    let totalCo2 = 0;
    let co2Counted = 0;

    for (let i = 0; i < this.data.length; i++) {
      const rating = ratingCol ? toString(this.data[i][ratingCol]).trim().toUpperCase() : '';
      const co2 = co2Col ? toNumber(this.data[i][co2Col]) : null;

      if (rating) {
        ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
      }

      if (co2 !== null) {
        totalCo2 += co2;
        co2Counted++;
      }

      // F and E ratings are the worst carbon performers
      if ((rating === 'F' || rating === 'E') && addressCol && highCarbonUrls.length < 20) {
        const url = toString(this.data[i][addressCol]);
        if (url) highCarbonUrls.push(url);
      }
    }

    if (co2Counted > 0) {
      stats.avg_co2_mg = Math.round(totalCo2 / co2Counted);
      stats.total_co2_mg = Math.round(totalCo2);
    }

    for (const [rating, count] of Object.entries(ratingCounts)) {
      stats[`rating_${rating}`] = count;
    }

    const poorRatingCount = (ratingCounts['F'] || 0) + (ratingCounts['E'] || 0);
    if (poorRatingCount > 0) {
      issues.push({
        type: 'high_carbon_pages',
        severity: 'warning',
        count: poorRatingCount,
        description: `${poorRatingCount} pages with poor carbon rating (E or F)`,
        urls: highCarbonUrls,
      });
    }

    return {
      total_pages: this.length,
      carbon_ratings: ratingCounts,
      stats,
      issues,
    };
  }
}
