import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class StructuredDataParser extends BaseParser {
  static parserKey = 'structureddata';
  static filenamePattern = ['structured_data_all', 'structured_data'];

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const errorsCol = this.findColumn(['Errors', 'Validation Errors']);
    const warningsCol = this.findColumn(['Warnings']);
    const richResultErrorsCol = this.findColumn(['Rich Result Errors']);
    const richResultWarningsCol = this.findColumn(['Rich Result Warnings']);
    const richResultFeaturesCol = this.findColumn(['Rich Result Features']);
    const totalTypesCol = this.findColumn(['Total Types']);
    const uniqueTypesCol = this.findColumn(['Unique Types']);

    // Type columns (Type-1 through Type-10)
    const typeColumns: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const col = this.findColumn([`Type-${i}`, `Type ${i}`]);
      if (col) typeColumns.push(col);
    }

    const issues: Issue[] = [];
    const schemaTypes: Record<string, number> = {};
    let pagesWithSchema = 0;
    let totalSchemaTypes = 0;

    // Count schema types
    for (let i = 0; i < this.data.length; i++) {
      const uniqueTypes = toNumber(this.data[i][uniqueTypesCol || '']);
      if (uniqueTypes !== null && uniqueTypes > 0) {
        pagesWithSchema++;
      }

      // Count individual types
      for (const typeCol of typeColumns) {
        const schemaType = toString(this.data[i][typeCol]);
        if (schemaType) {
          schemaTypes[schemaType] = (schemaTypes[schemaType] || 0) + 1;
          totalSchemaTypes++;
        }
      }
    }

    // Validation errors
    if (errorsCol) {
      const errorUrls: string[] = [];
      let errorCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const errors = toNumber(this.data[i][errorsCol]);
        if (errors !== null && errors > 0) {
          errorCount++;
          if (addressCol && errorUrls.length < 30) {
            errorUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (errorCount > 0) {
        issues.push({
          type: 'schema_validation_errors',
          severity: 'warning',
          count: errorCount,
          description: `${errorCount} pages with structured data validation errors`,
          urls: errorUrls,
        });
      }
    }

    // Validation warnings
    if (warningsCol) {
      let warningCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const warnings = toNumber(this.data[i][warningsCol]);
        if (warnings !== null && warnings > 0) {
          warningCount++;
        }
      }

      if (warningCount > 0) {
        issues.push({
          type: 'schema_validation_warnings',
          severity: 'notice',
          count: warningCount,
          description: `${warningCount} pages with structured data warnings`,
        });
      }
    }

    // Rich Result Errors
    if (richResultErrorsCol) {
      const errorUrls: string[] = [];
      let errorCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const errors = toNumber(this.data[i][richResultErrorsCol]);
        if (errors !== null && errors > 0) {
          errorCount++;
          if (addressCol && errorUrls.length < 20) {
            errorUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (errorCount > 0) {
        issues.push({
          type: 'rich_result_errors',
          severity: 'warning',
          count: errorCount,
          description: `${errorCount} pages with rich result validation errors`,
          urls: errorUrls,
        });
      }
    }

    // Count pages with rich results
    let pagesWithRichResults = 0;
    if (richResultFeaturesCol) {
      for (let i = 0; i < this.data.length; i++) {
        const features = toNumber(this.data[i][richResultFeaturesCol]);
        if (features !== null && features > 0) {
          pagesWithRichResults++;
        }
      }
    }

    // Sort schema types by count (descending) and limit to top 20
    const sortedSchemaTypes: Record<string, number> = {};
    Object.entries(schemaTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([key, value]) => {
        sortedSchemaTypes[key] = value;
      });

    return {
      total_pages: this.length,
      total_pages_with_schema: pagesWithSchema,
      pages_with_rich_results: pagesWithRichResults,
      schema_types: sortedSchemaTypes,
      issues,
    };
  }
}
