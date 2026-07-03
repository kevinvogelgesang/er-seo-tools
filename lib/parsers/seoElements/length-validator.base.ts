import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

type Severity = 'critical' | 'warning' | 'notice';

export interface LengthValidatorConfig {
  valueColumn: string[];
  missing: { type: string; severity: Severity; label: string };
  length?: {
    column: string[]; min: number; max: number; noun: string;
    shortType: string; shortSeverity: Severity;
    longType: string; longSeverity: Severity;
  };
  duplicate?: { type: string; severity: Severity; label: string; groupValueKey: 'title' | 'meta_description' | 'h1'; groupValueSlice: number };
  multiple?: { column: string[]; type: string; severity: Severity; label: string };
}

export abstract class LengthValidatorParser extends BaseParser {
  protected abstract readonly config: LengthValidatorConfig;

  parse(): ParsedData {
    if (this.isEmpty) return {};
    const cfg = this.config;

    const addressCol = this.findColumn(['Address', 'URL']);
    const valueCol = this.findColumn(cfg.valueColumn);
    const lengthCol = cfg.length ? this.findColumn(cfg.length.column) : null;
    const secondCol = cfg.multiple ? this.findColumn(cfg.multiple.column) : null;

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing
    if (valueCol) {
      const missingUrls: string[] = [];
      let missingCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const value = toString(this.data[i][valueCol]);
        if (!value) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) missingUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (missingCount > 0) {
        issues.push({
          type: cfg.missing.type,
          severity: cfg.missing.severity,
          count: missingCount,
          description: `${missingCount} pages missing ${cfg.missing.label}`,
          urls: missingUrls,
        });
      }
    }

    // Length (short / long)
    if (cfg.length && lengthCol) {
      const { min, max, noun, shortType, shortSeverity, longType, longSeverity } = cfg.length;
      const shortUrls: string[] = [];
      const longUrls: string[] = [];
      let shortCount = 0;
      let longCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const length = toNumber(this.data[i][lengthCol]);
        if (length === null) continue;
        if (length < min && length > 0) {
          shortCount++;
          if (addressCol && shortUrls.length < 20) shortUrls.push(toString(this.data[i][addressCol]));
        } else if (length > max) {
          longCount++;
          if (addressCol && longUrls.length < 20) longUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (shortCount > 0) {
        issues.push({
          type: shortType, severity: shortSeverity, count: shortCount,
          description: `${shortCount} pages with ${noun} under ${min} characters`,
          threshold: `< ${min} chars`, urls: shortUrls,
        });
      }
      if (longCount > 0) {
        issues.push({
          type: longType, severity: longSeverity, count: longCount,
          description: `${longCount} pages with ${noun} over ${max} characters`,
          threshold: `> ${max} chars`, urls: longUrls,
        });
      }
    }

    // Duplicate
    if (cfg.duplicate && valueCol) {
      const { type, severity, label, groupValueKey, groupValueSlice } = cfg.duplicate;
      const counts: Record<string, number> = {};
      const urlMap: Record<string, string[]> = {};
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const value = toString(this.data[i][valueCol]);
        if (value) {
          counts[value] = (counts[value] || 0) + 1;
          if (addressCol) {
            if (!urlMap[value]) urlMap[value] = [];
            if (urlMap[value].length < 50) urlMap[value].push(toString(this.data[i][addressCol]));
          }
        }
      }
      const duplicates = Object.entries(counts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
      if (duplicates.length > 0) {
        issues.push({
          type, severity, count: duplicates.length,
          description: `${duplicates.length} groups of pages with duplicate ${label}`,
          groups: duplicates.slice(0, 10).map(([value, count]) => ({
            [groupValueKey]: value.slice(0, groupValueSlice),
            count,
            urls: urlMap[value] ?? [],
          })) as Issue['groups'],
        });
      }
    }

    // Multiple
    if (cfg.multiple && secondCol) {
      const { type, severity, label } = cfg.multiple;
      const multipleUrls: string[] = [];
      let multipleCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const second = toString(this.data[i][secondCol]).trim();
        if (second) {
          multipleCount++;
          if (addressCol && multipleUrls.length < 20) multipleUrls.push(toString(this.data[i][addressCol]));
        }
      }
      if (multipleCount > 0) {
        issues.push({
          type, severity, count: multipleCount,
          description: `${multipleCount} pages with multiple ${label}`,
          urls: multipleUrls,
        });
      }
    }

    return { total_pages: totalPages, excluded_urls: this.length - totalPages, issues };
  }
}
