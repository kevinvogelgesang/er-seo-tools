import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ImagesParser extends BaseParser {
  static filenamePattern = 'images';

  private static LARGE_IMAGE_SIZE = 100 * 1024; // 100KB
  private static VERY_LARGE_IMAGE_SIZE = 500 * 1024; // 500KB

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const altTextCol = this.findColumn(['Alt Text', 'Alt']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);
    const widthCol = this.findColumn(['Width', 'img width', 'Image Width']); // NEW
    const heightCol = this.findColumn(['Height', 'img height', 'Image Height']); // NEW

    const issues: Issue[] = [];
    let totalImages = this.length;
    const stats: Record<string, number> = {};

    // Missing alt text + coverage percentage
    if (altTextCol) {
      const missingAltUrls: string[] = [];
      let missingAltCount = 0;
      let imagesWithAlt = 0;

      for (let i = 0; i < this.data.length; i++) {
        const alt = toString(this.data[i][altTextCol]);
        if (!alt) {
          missingAltCount++;
          if (addressCol && missingAltUrls.length < 30) {
            missingAltUrls.push(toString(this.data[i][addressCol]));
          }
        } else {
          imagesWithAlt++;
        }
      }

      stats.missing_alt = missingAltCount;
      // NEW — alt text coverage percentage
      const altCoveragePercent = totalImages > 0
        ? Math.round((imagesWithAlt / totalImages) * 1000) / 10
        : 100;
      stats.alt_coverage_percent = altCoveragePercent;
      stats.images_with_alt = imagesWithAlt; // NEW

      if (missingAltCount > 0) {
        issues.push({
          type: 'missing_alt_text',
          severity: altCoveragePercent < 80 ? 'warning' : 'notice', // NEW — escalate severity if < 80% coverage
          count: missingAltCount,
          description: `${missingAltCount} images missing alt text (${altCoveragePercent}% coverage)`,
          urls: missingAltUrls,
        });
      }
    }

    // Large images
    if (sizeCol) {
      const largeUrls: string[] = [];
      const veryLargeUrls: string[] = [];
      let largeCount = 0;
      let veryLargeCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size === null) continue;

        if (size > ImagesParser.VERY_LARGE_IMAGE_SIZE) {
          veryLargeCount++;
          if (addressCol && veryLargeUrls.length < 20) {
            veryLargeUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (size > ImagesParser.LARGE_IMAGE_SIZE) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) {
            largeUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.large_images = largeCount;
      stats.very_large_images = veryLargeCount;

      if (veryLargeCount > 0) {
        issues.push({
          type: 'very_large_images',
          severity: 'critical',
          count: veryLargeCount,
          description: `${veryLargeCount} very large images (> 500KB)`,
          urls: veryLargeUrls,
        });
      }

      if (largeCount > 0) {
        issues.push({
          type: 'large_images',
          severity: 'warning',
          count: largeCount,
          description: `${largeCount} large images (> 100KB)`,
          urls: largeUrls,
        });
      }
    }

    // Broken images
    if (statusCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          if (addressCol && brokenUrls.length < 30) {
            brokenUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.broken_images = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_images',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} broken images (4xx/5xx)`,
          urls: brokenUrls,
        });
      }
    }

    // NEW — Images missing Width or Height attributes (layout shift risk)
    if (widthCol || heightCol) {
      const missingDimsUrls: string[] = [];
      let missingDimsCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const width = widthCol ? toString(this.data[i][widthCol]) : null;
        const height = heightCol ? toString(this.data[i][heightCol]) : null;
        const missingWidth = widthCol && (!width || width === '0');
        const missingHeight = heightCol && (!height || height === '0');

        if (missingWidth || missingHeight) {
          missingDimsCount++;
          if (addressCol && missingDimsUrls.length < 30) {
            missingDimsUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.missing_dimensions = missingDimsCount; // NEW
      if (missingDimsCount > 0) {
        issues.push({
          type: 'images_missing_dimensions',
          severity: 'notice',
          count: missingDimsCount,
          description: `${missingDimsCount} images missing width/height attributes (layout shift risk)`,
          urls: missingDimsUrls,
        });
      }
    }

    return {
      total_images: totalImages,
      stats,
      issues,
    };
  }
}
