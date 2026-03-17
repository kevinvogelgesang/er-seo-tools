import { describe, it, expect } from 'vitest';
import { InternalParser } from './internal.parser';

describe('InternalParser', () => {
  it('should correctly parse valid CSV data', () => {
    const csvContent = `Address,Status Code,Indexability,Title 1,Meta Description 1,H1-1,Word Count,Crawl Depth
https://example.com/,200,Indexable,Home Page,Welcome to our site,Welcome,500,0
https://example.com/about,200,Indexable,About Us,About our company,About,350,1
https://example.com/contact,200,Indexable,Contact Us,,Contact,200,1
https://example.com/broken,404,Non-Indexable,Not Found,,,0,1`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.total_urls).toBe(4);

    // Status Codes
    expect(result.status_codes.ok_2xx).toBe(3);
    expect(result.status_codes.client_error_4xx).toBe(1);
    expect(result.status_codes.broken_urls).toContain('https://example.com/broken');

    // Indexability
    expect(result.indexability.indexable).toBe(3);
    expect(result.indexability.non_indexable).toBe(1);

    // SEO Elements
    expect(result.seo_elements_summary.missing_titles_count).toBe(0);
    expect(result.seo_elements_summary.missing_meta_count).toBe(1);
    expect(result.seo_elements_summary.missing_meta_urls).toContain('https://example.com/contact');

    // Content Metrics
    expect(result.content_metrics.avg_word_count).toBe(350);
    expect(result.content_metrics.thin_content_count).toBe(1);
  });

  it('should handle empty CSV', () => {
    const parser = new InternalParser('');
    const result = parser.parse();
    expect(result.total_urls).toBe(0);
    expect(result.status_codes.ok_2xx).toBe(0);
  });

  it('should handle different column names (legacy support)', () => {
    const csvContent = `URL,Status,Indexability
https://example.com/,200,Indexable`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.total_urls).toBe(1);
    expect(result.status_codes.ok_2xx).toBe(1);
  });
});
