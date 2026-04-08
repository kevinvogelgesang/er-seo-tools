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

  // --- GSC column extraction ---

  it('should set gsc_connected=true and extract gsc_top_pages when GSC columns are present', () => {
    const csvContent = `Address,Status Code,Clicks,Impressions,CTR,Position
https://example.com/,200,120,5000,2.4%,8.3
https://example.com/about,200,45,2000,2.25%,12.1
https://example.com/blog,200,200,8000,2.5%,5.0`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.gsc_connected).toBe(true);
    expect(result.gsc_top_pages).toBeDefined();
    expect(result.gsc_top_pages).toHaveLength(3);

    // sorted by impressions descending
    expect(result.gsc_top_pages![0].url).toBe('https://example.com/blog');
    expect(result.gsc_top_pages![0].impressions).toBe(8000);
    expect(result.gsc_top_pages![0].clicks).toBe(200);
    expect(result.gsc_top_pages![0].ctr_pct).toBe(2.5);
    expect(result.gsc_top_pages![0].average_position).toBe(5.0);

    expect(result.gsc_top_pages![1].url).toBe('https://example.com/');
    expect(result.gsc_top_pages![1].impressions).toBe(5000);
  });

  it('should skip GSC rows with 0 impressions', () => {
    const csvContent = `Address,Status Code,Clicks,Impressions,CTR,Position
https://example.com/,200,10,500,2%,10.0
https://example.com/zero,200,0,0,0%,0
https://example.com/about,200,5,200,2.5%,15.0`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.gsc_connected).toBe(true);
    expect(result.gsc_top_pages).toHaveLength(2);
    const urls = result.gsc_top_pages!.map(p => p.url);
    expect(urls).not.toContain('https://example.com/zero');
  });

  it('should cap gsc_top_pages at 50 sorted by impressions descending', () => {
    // Build 60 rows with varying impressions
    const rows = Array.from({ length: 60 }, (_, i) => {
      const imp = (60 - i) * 100; // 6000 down to 100
      return `https://example.com/page${i},200,${i},${imp},${(i * 0.1).toFixed(1)}%,${i + 1}`;
    });
    const csvContent = `Address,Status Code,Clicks,Impressions,CTR,Position\n${rows.join('\n')}`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.gsc_top_pages).toHaveLength(50);
    // First entry should have highest impressions (6000)
    expect(result.gsc_top_pages![0].impressions).toBe(6000);
    // Last entry should have the 50th highest impressions (11th row = (60-10)*100 = 5000 → actually row index 0 is 6000, row 49 is (60-49)*100 = 1100)
    expect(result.gsc_top_pages![49].impressions).toBe(1100);
  });

  // --- GA4 column extraction ---

  it('should set ga4_connected=true and extract ga4_top_pages when GA4 columns are present', () => {
    const csvContent = `Address,Status Code,GA4 Sessions,GA4 Views,GA4 Engaged sessions,GA4 Engagement rate,GA4 Bounce rate,GA4 Average session duration
https://example.com/,200,1500,3000,900,60%,35.5%,120.5
https://example.com/about,200,800,1200,400,50%,48.2%,90.0
https://example.com/blog,200,3000,6000,2100,70%,28.0%,180.0`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.ga4_connected).toBe(true);
    expect(result.ga4_top_pages).toBeDefined();
    expect(result.ga4_top_pages).toHaveLength(3);

    // sorted by sessions descending
    expect(result.ga4_top_pages![0].url).toBe('https://example.com/blog');
    expect(result.ga4_top_pages![0].sessions).toBe(3000);
    expect(result.ga4_top_pages![0].views).toBe(6000);
    expect(result.ga4_top_pages![0].engaged_sessions).toBe(2100);
    expect(result.ga4_top_pages![0].bounce_rate_pct).toBe(28.0);
    expect(result.ga4_top_pages![0].average_session_duration_seconds).toBe(180.0);

    expect(result.ga4_top_pages![1].url).toBe('https://example.com/');
    expect(result.ga4_top_pages![1].sessions).toBe(1500);
  });

  it('should skip GA4 rows with 0 sessions', () => {
    const csvContent = `Address,Status Code,GA4 Sessions,GA4 Views,GA4 Engaged sessions,GA4 Engagement rate,GA4 Bounce rate,GA4 Average session duration
https://example.com/,200,500,1000,300,60%,35%,100.0
https://example.com/zero,200,0,0,0,0%,0%,0
https://example.com/about,200,200,400,100,50%,45%,80.0`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.ga4_connected).toBe(true);
    expect(result.ga4_top_pages).toHaveLength(2);
    const urls = result.ga4_top_pages!.map(p => p.url);
    expect(urls).not.toContain('https://example.com/zero');
  });

  it('should cap ga4_top_pages at 50 sorted by sessions descending', () => {
    const rows = Array.from({ length: 60 }, (_, i) => {
      const sessions = (60 - i) * 100;
      return `https://example.com/page${i},200,${sessions},${sessions * 2},${sessions * 0.6},60%,35%,120`;
    });
    const csvContent = `Address,Status Code,GA4 Sessions,GA4 Views,GA4 Engaged sessions,GA4 Engagement rate,GA4 Bounce rate,GA4 Average session duration\n${rows.join('\n')}`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.ga4_top_pages).toHaveLength(50);
    expect(result.ga4_top_pages![0].sessions).toBe(6000);
    expect(result.ga4_top_pages![49].sessions).toBe(1100);
  });

  // --- No GSC/GA4 columns ---

  it('should set gsc_connected=false and ga4_connected=false when columns are absent', () => {
    const csvContent = `Address,Status Code,Indexability
https://example.com/,200,Indexable`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.gsc_connected).toBe(false);
    expect(result.ga4_connected).toBe(false);
    expect(result.gsc_top_pages).toBeUndefined();
    expect(result.ga4_top_pages).toBeUndefined();
  });

  it('should handle percentage strings with % stripped correctly for CTR', () => {
    const csvContent = `Address,Status Code,Clicks,Impressions,CTR,Position
https://example.com/,200,10,1000,1.75%,20.5`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.gsc_top_pages![0].ctr_pct).toBe(1.75);
  });

  it('should handle percentage strings with % stripped correctly for GA4 bounce rate', () => {
    const csvContent = `Address,Status Code,GA4 Sessions,GA4 Views,GA4 Engaged sessions,GA4 Engagement rate,GA4 Bounce rate,GA4 Average session duration
https://example.com/,200,500,1000,300,60%,42.75%,95.0`;

    const parser = new InternalParser(csvContent);
    const result = parser.parse();

    expect(result.ga4_top_pages![0].bounce_rate_pct).toBe(42.75);
  });
});
