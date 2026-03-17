import { CSVRow } from '../types';

/**
 * Get a column value from a CSV row, checking multiple possible column names.
 * Handles case-insensitive matching.
 */
export function getColumnValue(
  row: CSVRow,
  possibleNames: string[]
): string | number | null {
  for (const name of possibleNames) {
    if (row[name] !== undefined && row[name] !== null) {
      return row[name] as string | number;
    }
    // Case-insensitive fallback
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lowerName && row[key] !== undefined && row[key] !== null) {
        return row[key] as string | number;
      }
    }
  }
  return null;
}

/**
 * Find a column name from possible names in the headers.
 */
export function findColumnName(
  headers: string[],
  possibleNames: string[]
): string | null {
  for (const name of possibleNames) {
    if (headers.includes(name)) {
      return name;
    }
    // Case-insensitive fallback
    const lowerName = name.toLowerCase();
    for (const header of headers) {
      if (header.toLowerCase() === lowerName) {
        return header;
      }
    }
  }
  return null;
}

/**
 * Check if a value represents HTML content type
 */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = String(contentType).toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml');
}

/**
 * Check if a page is indexable
 */
export function isIndexable(indexability: string | null | undefined): boolean {
  if (!indexability) return false;
  return String(indexability).trim().toLowerCase() === 'indexable';
}

/**
 * Convert a value to a number, returning null for invalid values
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Convert a value to string safely
 */
export function toString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}
